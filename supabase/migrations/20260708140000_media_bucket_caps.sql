-- Harden the pre-existing PUBLIC `media` bucket the same way the `videos` bucket is
-- (20260708120000): cap the mime types and file size. A public bucket that accepts
-- text/html or image/svg+xml would serve stored XSS on the Supabase origin; the client
-- MediaUploader validates too, but bucket-level caps are the unbypassable guard.
-- Only affects NEW uploads — existing objects (hero images/videos, profile photos)
-- already fit these types.
update storage.buckets
  set file_size_limit = 524288000,
      allowed_mime_types = array[
        'image/jpeg', 'image/png', 'image/webp', 'image/gif',
        'video/mp4', 'video/webm', 'video/quicktime'
      ]
  where id = 'media';
