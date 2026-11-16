"""
AGENT 1 — Storage Agent
Handles all Azure Blob Storage operations: upload, delete, list.
"""

import os
import uuid
from urllib.parse import unquote, urlsplit

from werkzeug.utils import secure_filename
from azure.core.exceptions import ResourceNotFoundError
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
    "mst": "notes",
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
        unique_prefix = uuid.uuid4().hex
        safe_filename = secure_filename(original_filename) or 'document.pdf'
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
        url = urlsplit(blob_url)
        if url.scheme != 'https' or url.netloc != urlsplit(blob_service.url).netloc:
            print('[StorageAgent] Refusing to delete a file outside the configured storage account.')
            return False

        container_name, _, blob_name = unquote(url.path).lstrip('/').partition('/')
        if not container_name or not blob_name:
            return False

        container_client = blob_service.get_container_client(container_name)
        blob_client = container_client.get_blob_client(blob_name)
        blob_client.delete_blob(connection_timeout=5, read_timeout=10, retry_total=0)

        print(f"[StorageAgent] Deleted '{blob_name}' from '{container_name}'")
        return True

    except ResourceNotFoundError as error:
        # A previous attempt may have deleted the blob before the DB commit.
        return error.error_code == 'BlobNotFound'
    except Exception as e:
        print(f"[StorageAgent] Delete error: {e}")
        return False
    finally:
        blob_service.close()


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
