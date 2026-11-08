/**
 * "Load file" for the payload editor: printable UTF-8 becomes text (or JSON), anything else
 * hex. Large files load with a warning.
 */
import { ref, toValue, type MaybeRefOrGetter, type Ref } from 'vue'
import { toast } from 'vue-sonner'
import { api, errorMessage } from '@/services/api'
import { usePublishStore } from '@/stores'
import { formatBytes } from '@/utils/format'
import { LARGE_PAYLOAD_BYTES, payloadFromFile } from '../utils/payload-file'
import { FORMAT_META } from '../utils/payload-tools'

export interface PayloadFile {
  /** The file dialog is open or the file is being read. */
  loading: Readonly<Ref<boolean>>
  /** @returns whether a file was loaded into the draft. */
  load(): Promise<boolean>
}

export function usePayloadFile(connectionId: MaybeRefOrGetter<string>): PayloadFile {
  const publish = usePublishStore()
  const loading = ref(false)

  async function load(): Promise<boolean> {
    if (loading.value) return false
    loading.value = true
    try {
      const file = await api.dialog.openFile({ title: 'Load payload from a file' })
      if (!file) return false
      const { payload, format } = payloadFromFile(file.data)
      publish.updateDraft(toValue(connectionId), { payload, format })
      const detail = `${formatBytes(file.size)} · loaded as ${FORMAT_META[format].short}`
      if (file.size > LARGE_PAYLOAD_BYTES) {
        toast.warning(`${file.name} is large`, {
          description: `${detail}. Big payloads slow the editor down and are not saved with the draft.`
        })
      } else {
        toast.success(`Loaded ${file.name}`, { description: detail })
      }
      return true
    } catch (err) {
      toast.error('Could not open the file', { description: errorMessage(err) })
      return false
    } finally {
      loading.value = false
    }
  }

  return { loading, load }
}
