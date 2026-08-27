"""
AGENT 1 — Storage Agent
Handles all Azure Blob Storage operations: upload, delete, list.
"""

import os
import uuid
from azure.storage.blob import BlobServiceClient
from dotenv import load_dotenv

load_dotenv()

CONNECTION_STRING = os.getenv("s_connection_string")

# Map form category values to Azure container names
CATEGORY_CONTAINER_MAP = {
    "pyq": "pyq",
    "assignment": "assignments",
    "book": "notes",
    "notes": "notes",
}


def get_blob_service():
    """Returns a BlobServiceClient instance."""
    try:
        return BlobServiceClient.from_connection_string(CONNECTION_STRING)
    except Exception as e:
        print(f"[StorageAgent] Error creating BlobServiceClient: {e}")
        return None


def upload_file(file_stream, original_filename, category):
    """
    Uploads a file to the correct Azure container based on category.

    Args:
        file_stream: The file object / stream to upload.
        original_filename: The original name of the file.
        category: One of 'pyq', 'assignment', 'book', 'notes'.

    Returns:
        dict with 'blob_url', 'blob_name', 'container' on success.
        None on failure.
    """
    container_name = CATEGORY_CONTAINER_MAP.get(category)
    if not container_name:
        print(f"[StorageAgent] Unknown category: {category}")
        return None

    blob_service = get_blob_service()
    if not blob_service:
        return None

    try:
        # Generate a unique blob name to prevent collisions
        unique_prefix = uuid.uuid4().hex[:8]
        safe_filename = original_filename.replace(" ", "_")
        blob_name = f"{unique_prefix}_{safe_filename}"

        # Get the container client and upload
        container_client = blob_service.get_container_client(container_name)
        blob_client = container_client.get_blob_client(blob_name)

        blob_client.upload_blob(file_stream, overwrite=True)

        # Build the public URL 
        blob_url = blob_client.url

        print(f"[StorageAgent] Uploaded '{blob_name}' to container '{container_name}'")
        return {
            "blob_url": blob_url,
            "blob_name": blob_name,
            "container": container_name,
        }

    except Exception as e:
        print(f"[StorageAgent] Upload error: {e}")
        return None


def delete_file(blob_url):
    """
    Deletes a blob from Azure Storage given its full URL.

    Args:
        blob_url: The full public URL of the blob.

    Returns:
        True on success, False on failure.
    """
    blob_service = get_blob_service()
    if not blob_service:
        return False

    try:
        # Parse container and blob name from the URL
        # URL format: https://<account>.blob.core.windows.net/<container>/<blob_name>
        parts = blob_url.split(".blob.core.windows.net/")
        if len(parts) != 2:
            print(f"[StorageAgent] Could not parse blob URL: {blob_url}")
            return False

        path = parts[1]
        container_name = path.split("/")[0]
        blob_name = "/".join(path.split("/")[1:])

        container_client = blob_service.get_container_client(container_name)
        blob_client = container_client.get_blob_client(blob_name)
        blob_client.delete_blob()

        print(f"[StorageAgent] Deleted '{blob_name}' from '{container_name}'")
        return True

    except Exception as e:
        print(f"[StorageAgent] Delete error: {e}")
        return False


def list_files(container_name):
    """
    Lists all blobs in a given container.

    Args:
        container_name: Name of the Azure container.

    Returns:
        List of dicts with 'name', 'url', 'size', 'last_modified'.
    """
    blob_service = get_blob_service()
    if not blob_service:
        return []

    try:
        container_client = blob_service.get_container_client(container_name)
        blobs = container_client.list_blobs()

        result = []
        for blob in blobs:
            blob_url = f"https://{blob_service.account_name}.blob.core.windows.net/{container_name}/{blob.name}"
            result.append({
                "name": blob.name,
                "url": blob_url,
                "size": blob.size,
                "last_modified": str(blob.last_modified) if blob.last_modified else None,
            })

        return result

    except Exception as e:
        print(f"[StorageAgent] List error: {e}")
        return []
