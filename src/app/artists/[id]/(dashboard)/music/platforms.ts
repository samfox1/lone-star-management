import { type IconType } from 'react-icons'
import { SiApplemusic, SiDeezer, SiSoundcloud, SiSpotify } from 'react-icons/si'
import type { SongPlatform } from '@/lib/song-links'

/** The streaming services a RELEASE can link out to — one fixed slot each, with its brand
 *  mark (react-icons). The `label` is also the key stored in `release.links`. */
export const STREAMING_PLATFORMS: { label: string; Icon: IconType; color: string; placeholder: string }[] = [
  { label: 'Spotify', Icon: SiSpotify, color: 'text-[#1DB954]', placeholder: 'Spotify link' },
  { label: 'Apple Music', Icon: SiApplemusic, color: 'text-[#FA243C]', placeholder: 'Apple Music link' },
  { label: 'SoundCloud', Icon: SiSoundcloud, color: 'text-[#FF5500]', placeholder: 'SoundCloud link' },
  { label: 'Deezer', Icon: SiDeezer, color: 'text-[#A238FF]', placeholder: 'Deezer link' },
]

/** A SONG's editable per-platform link fields (the sync-only ids like spotify_id /
 *  deezer_id aren't manually set, so they aren't slots here). Shared by every place a
 *  song opens, so a song reads the same wherever it lives. */
export const SONG_PLATFORMS: {
  field: 'stream_url' | 'soundcloud_url' | 'apple_url' | 'deezer_url'
  /** Whose links this row holds — a link recognisably another platform's is refused
   *  (lib/song-links wrongPlatformError). */
  platform: SongPlatform
  label: string
  Icon: IconType
  color: string
  placeholder: string
}[] = [
  { field: 'stream_url', platform: 'spotify', label: 'Spotify', Icon: SiSpotify, color: 'text-[#1DB954]', placeholder: 'Spotify link' },
  { field: 'apple_url', platform: 'apple', label: 'Apple Music', Icon: SiApplemusic, color: 'text-[#FA243C]', placeholder: 'Apple Music link' },
  { field: 'soundcloud_url', platform: 'soundcloud', label: 'SoundCloud', Icon: SiSoundcloud, color: 'text-[#FF5500]', placeholder: 'SoundCloud link' },
  { field: 'deezer_url', platform: 'deezer', label: 'Deezer', Icon: SiDeezer, color: 'text-[#A238FF]', placeholder: 'Deezer link' },
]
