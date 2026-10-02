# Bookshelf

Flask website for the student library and its delegated management workspaces.

- Application: `app.py`, supporting Python services, `templates/`, and `static/`.
- Tests: `tests/` (Python) and `checks/` (frontend checks).
- Guides: [roles and UI editor](docs/ROLES.md), [communications](docs/COMMUNICATIONS.md).
- Design source backups: `assets/source/`.
- Local tooling and generated previews: `.dev/` (ignored by Git).
- `admin only/` is the separate local PYQ management tool.

Install `requirements.txt` in your Python environment, configure the existing
`.env` settings, and start the application with `python app.py`. Startup runs the
idempotent database migrations, including departments and website effects.

Run the offline regression suite:

```sh
python -m unittest discover -s tests -p "test_*.py"
```

Admin role assignments are at `/admin/roles`. Users assigned the UI editor role
manage departments and snowfall at `/dashboard/appearance`.
