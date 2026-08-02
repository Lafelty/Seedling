// Profile pictures live in a private Supabase Storage bucket, so what the
// profiles row holds is an object *path*, never a URL: a URL into a private
// bucket is a signed one and expires. Every page that shows a photo mints its
// own short-lived signature at load time.
//
// See supabase/migrations/20260802000000_profile_phone_avatar.sql for the bucket
// and the policies that decide who may sign what.

import type { createClient } from '@/lib/supabase/client';

type SupabaseClient = ReturnType<typeof createClient>;

export const AVATAR_BUCKET = 'avatars';

/** Matches the bucket's own `file_size_limit`, so the check fails early and kindly. */
export const MAX_AVATAR_BYTES = 2 * 1024 * 1024;

/** Matches the bucket's `allowed_mime_types`. */
export const AVATAR_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;

/** How long a signed avatar URL stays good. Long enough to sit on a page. */
const SIGNED_URL_TTL_SECONDS = 3600;

const EXTENSION_BY_TYPE: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

/**
 * Why the file is not acceptable, or null when it is. Returned as a message
 * rather than a boolean because the caller has nothing better to say than this.
 */
export function rejectAvatar(file: File): string | null {
  if (!AVATAR_MIME_TYPES.includes(file.type as (typeof AVATAR_MIME_TYPES)[number])) {
    return 'Pictures need to be a JPG, PNG or WebP.';
  }
  if (file.size > MAX_AVATAR_BYTES) {
    return 'That picture is over 2 MB. Please pick a smaller one.';
  }
  return null;
}

/**
 * `<user-id>/avatar-<timestamp>.<ext>` — the leading folder is what the storage
 * policies check ownership against, so it must be the user's own id. The
 * timestamp gives each upload its own object, which is what lets a replaced
 * photo stop being served the instant the row points elsewhere.
 */
export function avatarObjectPath(userId: string, file: File): string {
  const ext = EXTENSION_BY_TYPE[file.type] ?? 'jpg';
  return `${userId}/avatar-${Date.now()}.${ext}`;
}

/** A viewable URL for one stored path, or null if it cannot be signed. */
export async function signAvatar(
  supabase: SupabaseClient,
  path: string | null | undefined
): Promise<string | null> {
  if (!path) return null;
  const { data, error } = await supabase.storage
    .from(AVATAR_BUCKET)
    .createSignedUrl(path, SIGNED_URL_TTL_SECONDS);
  if (error) {
    console.error('Error signing avatar:', error);
    return null;
  }
  return data?.signedUrl ?? null;
}

/**
 * The same for a whole list, in one round trip — the patient table on
 * /starconfig would otherwise make one request per row.
 */
export async function signAvatars(
  supabase: SupabaseClient,
  paths: (string | null | undefined)[]
): Promise<Map<string, string>> {
  const wanted = Array.from(new Set(paths.filter((p): p is string => !!p)));
  const signed = new Map<string, string>();
  if (wanted.length === 0) return signed;

  const { data, error } = await supabase.storage
    .from(AVATAR_BUCKET)
    .createSignedUrls(wanted, SIGNED_URL_TTL_SECONDS);

  if (error) {
    console.error('Error signing avatars:', error);
    return signed;
  }

  for (const entry of data ?? []) {
    // A per-object failure (deleted file, policy miss) shows up inside the
    // array rather than as a thrown error; that row just goes without a photo.
    if (entry.path && entry.signedUrl) signed.set(entry.path, entry.signedUrl);
  }
  return signed;
}

/** Best-effort cleanup of a photo the patient has replaced. */
export async function removeAvatar(
  supabase: SupabaseClient,
  path: string | null | undefined
): Promise<void> {
  if (!path) return;
  const { error } = await supabase.storage.from(AVATAR_BUCKET).remove([path]);
  if (error) console.error('Error removing old avatar:', error);
}
