-- Morning Brief / Evening Debrief: the daily_reports table now stores three
-- snapshot types. Existing rows are the legacy full-day snapshot ('daily');
-- 'morning' and 'evening' are the new attention-ordered briefs, generated
-- automatically by the scheduler and on demand from the Reports page.
ALTER TABLE daily_reports ADD COLUMN report_type TEXT NOT NULL DEFAULT 'daily';

CREATE INDEX IF NOT EXISTS idx_reports_type_date ON daily_reports(report_type, report_date);
