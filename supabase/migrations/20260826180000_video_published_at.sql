-- The video's OWN publish date (SEO/GEO review, 2026-08-26): VideoObject.uploadDate was
-- the day the manager added the link, which is not what Google asks for. YouTube's sync
-- fills this from the upload playlist's snippet.publishedAt; uploads and hand-added
-- embeds may leave it null, and a video with no known date is simply not stated in the
-- fact sheet (never invented).
alter table videos add column if not exists published_at timestamptz;
comment on column videos.published_at is 'When the video was published on its platform; null = unknown';
