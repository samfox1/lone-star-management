/** Facebook: link only, by page name (`facebook.com/` [skeenmusic]). See README.md. */
import { slash, type Service } from '../service'

export const facebook: Service = {
  slug: 'facebook',
  social: {
    key: 'facebook',
    method: {
      noun: 'page name',
      hosts: ['facebook.com', 'fb.com'],
      rule: /^[A-Za-z0-9.]{2,50}$/,
      example: 'skeenmusic',
      ...slash('facebook.com'),
      // A profile with no page name is `profile.php?id=<digits>`: keep that link as it is.
      fromPath: (segments, url) => {
        const id = url.searchParams.get('id')
        if (segments[0] === 'profile.php' && id && /^\d+$/.test(id)) return { url: `https://facebook.com/profile.php?id=${id}` }
        return undefined
      },
    },
  },
}
