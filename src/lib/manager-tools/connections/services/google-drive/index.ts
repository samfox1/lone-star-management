/** Google Drive: a service, by folder link. Not a catalog source: a link-shared folder the
 *  dashboard can browse and copy-import audio/images/videos from ("Check" verifies sharing
 *  + counts). See README.md. */
import type { Service } from '../service'

export const googleDrive: Service = {
  slug: 'google-drive',
  source: { key: 'drive', label: 'Google Drive', section: 'files', idField: 'drive_folder_id', placeholder: 'Google Drive folder link', pullLabel: 'Check folder' },
}
