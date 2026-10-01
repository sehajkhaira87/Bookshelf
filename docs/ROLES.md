# Dashboard roles

Administrators assign any combination of roles from **Control room → Role assignments**
(`/admin/roles`). Search for an existing account, check one, two, or all three roles,
and select **Save roles**. Uncheck a role to remove just that permission; clear all
checkboxes to return the account to ordinary **Student** access. No accounts receive
staff access automatically.
Role changes apply on the next request, including sessions that are already signed in.

Administrators sign in at `/admin` with **Continue with Google**, using an email
in the `Emails` allowlist and an existing, active account. This uses the existing
`google_Client_ID` and `google_Client_Secret` configuration and `/callback` redirect
URI. The student `/login` form continues to use CRN/password. Already signed-in
administrators who visit `/login` or `/dashboard` return to the control room.

| Role | Dashboard section | Powers |
| --- | --- | --- |
| Notification head | `/dashboard/notifications` | Publish, update, and remove the official announcement; send notifications to all or selected students; review send history. |
| User manager | `/dashboard/users` | Search students; suspend/restore access; issue/remove warnings; assign contributor badges; preview, verify, return to review, or delete student contributions. |
| UI editor | `/dashboard/appearance` | Preview and publish the dashboard title, starting instruction, welcome banner, accent palette, card shape, spacing, and website snowfall; add departments; restore appearance defaults. |

The main dashboard renders a workspace link and card for every assigned role.
Role workspaces also link to the account's other assigned sections. Ordinary
students retain the library and their personal notification inbox. Each workspace
checks for its required role on direct URL requests and POSTs, including accounts
holding multiple roles. Removing one role leaves the other grants intact.
Administrators retain their existing control room; the dedicated dashboard
workspaces require their respective assigned roles.

Only the configured administrator allowlist (`Emails`) can assign roles; roles
cannot grant administrator access. User managers cannot moderate administrators,
staff accounts, themselves, or uploads belonging to those protected accounts.
Mutations require a session CSRF token. Banned, missing, and revoked staff accounts
cannot access their previous workspace. Privileged pages use `private, no-store`.

## Persistence

Normal application startup runs idempotent schema creation after the users table:

- `users.roles`: the authoritative array of assigned staff roles; an empty array means Student access.
- `users.role`: retained for compatibility and synchronized to the first staff role, or `student`.
- `user_role_changes`: records the target account, complete previous/new role arrays, assigning administrator, and time; historical single-role audit fields are retained.
- `site_appearance`: stores the shared dashboard appearance and editor attribution.
- `site_departments`: stores department codes, names, built-in icon choices, optional uploaded PNG data, and creator attribution. Startup seeds the six existing departments without overwriting records.

Deploy using the app's existing Flask process and PostgreSQL connection. The
database account must have its existing schema migration permissions. No manual
role creation or new credentials are required. Startup migrates existing single-role
assignments into the new array only when it is uninitialized. Repeated startups
preserve multiple assignments and explicit revocations. Existing students remain
students. Role assignment for a banned account requires restoring access first;
removing all of its staff roles is always allowed.

Appearance options are fixed, validated choices and escaped text. Editors cannot
insert executable HTML, CSS, or JavaScript. Version checks prevent one editor
from silently overwriting another editor's changes. Public dashboards fall back
to default appearance when settings cannot be read; the editor reports the failure.

## Departments and snowfall

In the UI editor, use **Departments → Add a department**. Enter a unique 2–12
character code starting with a letter, a display name, and choose a built-in icon
or use **Upload your own icon**. PNG, JPG, and WebP still images are accepted up
to 2 MB and 2048 × 2048 pixels. The preview shows your upload; **Use built-in icon**
clears it. Uploads are decoded and resized to at most 256 × 256 pixels, stripped
of metadata, and stored as PNG data with the department in the same transaction.
The icon is served through `/departments/<code>/icon.png`; no local upload folder
or additional cloud-storage configuration is required. After a server validation
error, choose the file again (browsers cannot repopulate file inputs).
The department is published immediately in dashboard cards, profile setup,
contribution/admin upload forms, and resource filters. The same catalogue validates
profile updates and resource uploads. Department names are escaped, and duplicate
codes cannot replace an existing department. This screen adds departments; existing
departments and their resources are retained.

Choose **Website snowfall → On** and **Publish appearance** to enable the effect
on website pages. Snowfall defaults to off, ignores pointer input, pauses in hidden
tabs, and is disabled for visitors requesting reduced motion. The live preview
shows the draft effect before publishing. **Restore defaults** turns snowfall off
and restores appearance options, without removing departments.

Student contributions are existing `resources` records associated with registered
student emails. This change adds their moderation workspace; it does not introduce
a new student upload pipeline.

## Validation

Install `requirements.txt` in a compatible Python environment, then run:

```sh
python -m unittest discover -s tests -p "test_*.py"
```

Tests cover single and combined workspace visibility, direct requests across
roles, multiple-role assignment, CSRF, immediate partial and full revocation,
moderation boundaries, notification attribution,
appearance validation, revision conflicts, and persistence failures. Service calls
are mocked; the tests do not publish notifications or change production accounts.
