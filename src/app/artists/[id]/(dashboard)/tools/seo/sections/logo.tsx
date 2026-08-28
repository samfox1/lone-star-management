import { OgImagePicker, type OgSource } from '../og-image-picker'
import { GroupLabel, SeeIt } from './rows'

/** The picture shown when the site is shared (iMessage, X, Instagram). */
export function LogoSection({ artistId, sources, currentUrl }: { artistId: string; sources: OgSource[]; currentUrl: string }) {
  return (
    <div>
      <GroupLabel>Share image</GroupLabel>
      <div className="rounded-b-xl bg-surface px-5 pb-4 pt-3">
        <OgImagePicker artistId={artistId} sources={sources} currentUrl={currentUrl} />
      </div>
      <SeeIt>paste the site&rsquo;s address into iMessage or X and look at the card.</SeeIt>
    </div>
  )
}
