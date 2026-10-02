# Official announcements and notifications

Open **Admin panel → Notices & notifications** (`/admin/communications`).

- Publish or edit the single official announcement at the top of the student dashboard. The title and message are required; a link is optional. Remove hides the bar and keeps the last text in the editor for reuse. Students see changes when they open or refresh the dashboard.
- Send a separate notification to all currently registered, active students, or search and select up to 500 students by name, email, URN or CRN. Administrator accounts and banned accounts are excluded. Selecting everyone captures the eligible students at send time; future registrations do not receive earlier messages.
- Students have a notification bell beside their Google profile photo, with an initial fallback when no photo is available. Existing signed-in sessions acquire the photo on their next Google sign-in. Notifications persist across sessions; students can mark one or all messages as read and load older messages.
- The unread count refreshes every 30 seconds while the dashboard is visible. Opening the bell fetches the latest messages. The send history shows the latest 50 sends with recipient and read counts.

These are in-site notifications, not email, operating-system notifications, or browser push. Publishing a banner does not automatically send a notification.

## Active students

The admin overview includes an **Active now** count linked to the User database's active-student list. It refreshes every 30 seconds and lists the latest 50 students, with a total covering all active students. Click a name to find that account in the user database.

Active means a signed-in, non-banned student whose visible dashboard or study-resource page reported activity within five minutes. Pages report immediately and once a minute while visible; repeated reports within 30 seconds do not rewrite the database timestamp. Closing, hiding, or signing out naturally expires the student's activity within five minutes. This is approximate recent presence, not proof that the student is continuously interacting. Administrators are excluded.

Startup adds the nullable `users.last_seen_at` timestamp and its index. Historical accounts start with no recorded activity; presence failures display an unavailable state rather than zero active students.

## Deployment and storage

No new dependencies or environment credentials are required. Restart or redeploy the website normally. After the existing users schema initializes, startup creates three additive PostgreSQL tables in the same database:

| Table | Stores |
| --- | --- |
| `official_announcement` | One editable banner, visibility, revision and admin audit fields |
| `student_notifications` | Message content, audience, sender, time and a unique send key |
| `student_notification_recipients` | Recipient membership and each student's read time |

Startup publishes no banner and sends no notifications. Initialization is repeatable and preserves existing data. The standalone `admin only` importer does not use these tables or import this feature.

Admin mutations require admin authentication and CSRF protection. Student endpoints resolve the recipient from the authenticated account, never a client-supplied user ID. Messages are plain text; links accept HTTP(S) URLs or internal paths. A single transaction stores each notification and its recipients. A unique form key makes retrying an uncertain send safe. Stale announcement edits are rejected using the saved revision.

If schema initialization fails, check the website startup logs and the configured database user's create-table permissions before restarting. The admin workspace reports unavailability rather than pretending to publish or send.

## Verification

With the website dependencies installed, run `python -m unittest discover -s tests -p "test_*.py"` from the repository root. Tests mock database and cloud calls; they never send real notifications. Coverage includes admin and student access controls, CSRF, announcement publishing/removal, text escaping, recipient selection, duplicate sends, transaction rollback, private read state and pagination.

Browser verification should use local fixtures to check the bell, unread count, individual/all read actions, recipient selection across searches, empty/error states, keyboard dismissal, profile-photo fallback, and desktop/mobile layouts.
