-- Per-user permissions replace the four fixed roles. Each user now carries an
-- explicit JSON array of permission keys (users.permissions), assigned by
-- whoever holds user.manage from Settings → Team Accounts. The legacy role
-- column is kept (unused) so old rows stay valid; existing users are
-- backfilled with exactly the permissions their role granted.
ALTER TABLE users ADD COLUMN permissions TEXT;

UPDATE users SET permissions =
  '["event.create","event.view","event.view.all","event.edit","event.edit.all","event.status.change","event.cancel","event.archive","checklist.update","task.create","task.complete","task.assign","task.view.all","document.upload","document.delete","conflict.override","date.correct","report.generate","report.view","analytics.view","announcement.manage","user.manage","settings.manage","notification.rules.manage","audit.view"]'
  WHERE role = 'admin';

UPDATE users SET permissions =
  '["event.create","event.view","event.view.all","event.edit","event.edit.all","event.status.change","event.cancel","event.archive","checklist.update","task.create","task.complete","task.assign","task.view.all","document.upload","document.delete","conflict.override","date.correct","report.generate","report.view","analytics.view"]'
  WHERE role = 'venue_manager';

UPDATE users SET permissions =
  '["event.create","event.view","event.edit","checklist.update","task.create","task.complete","document.upload","report.view"]'
  WHERE role = 'coordinator';

UPDATE users SET permissions = '["event.view","report.view"]'
  WHERE role = 'viewer' OR permissions IS NULL;

-- Role-addressed notifications become permission-addressed: a notification is
-- visible to whoever holds the named permission.
ALTER TABLE notifications RENAME COLUMN recipient_role TO recipient_permission;

UPDATE notifications SET recipient_permission = CASE recipient_permission
  WHEN 'admin' THEN 'user.manage'
  WHEN 'venue_manager' THEN 'task.assign'
  WHEN 'coordinator' THEN 'task.complete'
  WHEN 'viewer' THEN 'event.view'
  ELSE recipient_permission
END
WHERE recipient_permission IN ('admin', 'venue_manager', 'coordinator', 'viewer');
