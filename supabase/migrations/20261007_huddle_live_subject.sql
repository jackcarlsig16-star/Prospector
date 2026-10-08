-- huddle-live-feed-v1 add-on: the email's subject line, from the
-- /emailer_messages/search results the sync already fetches (0 extra Apollo
-- calls). Filled on the next sync for every message in its 30-day window.
-- Apollo's click events carry no URL, so there is no clicked-link column.
alter table sales_email_messages add column if not exists subject text;
