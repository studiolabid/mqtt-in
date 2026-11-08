<script setup lang="ts">
/**
 * TLS/SSL: verification, CA / client certificate / key files, passphrase, SNI and ALPN.
 * Only used by mqtts:// and wss://: otherwise a notice says so and offers to switch. The fields
 * stay editable at full contrast (no dimming: faded text and field borders fall under the
 * WCAG minimums, A11Y-04).
 * The files must be PEM (Base-64) and at most 1 MB: the main process refuses DER (the usual
 * Windows .cer export) and larger files, so the hint under the pickers says it up front.
 */
import { computed, useId } from 'vue'
import { FileBadgeIcon, FileKeyIcon, InfoIcon, ShieldOffIcon, TriangleAlertIcon } from '@lucide/vue'
import type { FileFilter, MqttProtocol } from '@shared/models'
import { isTlsProtocol } from '@shared/defaults'
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field'
import {
  TagsInput,
  TagsInputInput,
  TagsInputItem,
  TagsInputItemDelete,
  TagsInputItemText
} from '@/components/ui/tags-input'
import { useConnectionForm } from '../../composables/useConnectionForm'
import FilePathInput from '../fields/FilePathInput.vue'
import PasswordInput from '../fields/PasswordInput.vue'
import SecretStorageNote from '../fields/SecretStorageNote.vue'
import SectionHeader from '../fields/SectionHeader.vue'
import SectionNotice from '../fields/SectionNotice.vue'
import SwitchCard from '../fields/SwitchCard.vue'
import TextInput from '../fields/TextInput.vue'

const CERTIFICATES: readonly FileFilter[] = [
  { name: 'Certificates', extensions: ['pem', 'crt', 'cer'] }
]
const KEYS: readonly FileFilter[] = [{ name: 'Private keys', extensions: ['pem', 'key'] }]

const { draft, errors, setProtocol } = useConnectionForm()
const ids = {
  ca: useId(),
  cert: useId(),
  keyFile: useId(),
  passphrase: useId(),
  servername: useId(),
  alpn: useId(),
  fileFormat: useId()
}

const active = computed(() => isTlsProtocol(draft.value.protocol))
const secureProtocol = computed<MqttProtocol>(() =>
  draft.value.protocol === 'ws' ? 'wss' : 'mqtts'
)
const verify = computed(() => draft.value.tls.rejectUnauthorized)
// Built here: a template literal containing "://" inside a binding breaks vue-tsc's codegen.
const notice = computed(() => ({
  description: `${draft.value.protocol}:// is not encrypted. These settings apply to ${secureProtocol.value}://.`,
  action: `Switch to ${secureProtocol.value}://`
}))

function onAlpn(value: unknown[]): void {
  draft.value.tls.alpnProtocols = value.map(String)
}
</script>

<template>
  <div class="flex flex-col gap-6">
    <SectionHeader section="tls" />
    <SectionNotice
      v-if="!active"
      :icon="ShieldOffIcon"
      title="TLS is off for this connection"
      :description="notice.description"
      :action-label="notice.action"
      @action="setProtocol(secureProtocol)"
    />
    <FieldGroup class="gap-5">
      <SwitchCard
        v-model="draft.tls.rejectUnauthorized"
        title="Verify server certificate"
        :tone="verify ? 'default' : 'warning'"
        :description="
          verify
            ? 'Reject brokers whose certificate is untrusted or does not match the host.'
            : 'Certificate errors are ignored. Use this only for self-signed test brokers.'
        "
      >
        <template v-if="!verify" #icon>
          <TriangleAlertIcon class="size-3.5 text-warning" aria-hidden="true" />
        </template>
      </SwitchCard>

      <Field>
        <FieldLabel :for="ids.ca">CA certificate</FieldLabel>
        <FilePathInput
          :id="ids.ca"
          v-model="draft.tls.caPath"
          dialog-title="Choose a CA certificate"
          :filters="CERTIFICATES"
          :icon="FileBadgeIcon"
          placeholder="System trust store"
          :aria-describedby="ids.fileFormat"
        />
        <FieldDescription class="text-xs">
          Needed for brokers signed by a private or self-signed authority.
        </FieldDescription>
      </Field>
      <Field>
        <FieldLabel :for="ids.cert">Client certificate</FieldLabel>
        <FilePathInput
          :id="ids.cert"
          v-model="draft.tls.certPath"
          dialog-title="Choose the client certificate"
          :filters="CERTIFICATES"
          :icon="FileBadgeIcon"
          :aria-describedby="ids.fileFormat"
        />
      </Field>
      <Field>
        <FieldLabel :for="ids.keyFile">Client key</FieldLabel>
        <FilePathInput
          :id="ids.keyFile"
          v-model="draft.tls.keyPath"
          dialog-title="Choose the client private key"
          :filters="KEYS"
          :icon="FileKeyIcon"
          :aria-describedby="ids.fileFormat"
        />
        <FieldDescription class="text-xs">
          A client certificate and key authenticate this client (mutual TLS).
        </FieldDescription>
      </Field>
      <p
        :id="ids.fileFormat"
        data-testid="tls-file-format-hint"
        class="-mt-2 flex items-start gap-1.5 text-xs text-muted-foreground"
      >
        <InfoIcon class="mt-px size-3.5 shrink-0" aria-hidden="true" />
        <span>CA, certificate and key: PEM (Base-64) files, up to 1 MB</span>
      </p>

      <div class="grid gap-4 sm:grid-cols-2">
        <Field>
          <FieldLabel :for="ids.passphrase">Key passphrase</FieldLabel>
          <PasswordInput :id="ids.passphrase" v-model="draft.tls.passphrase" placeholder="None" />
        </Field>
        <Field :data-invalid="errors.servername ? true : undefined">
          <FieldLabel :for="ids.servername">Server name (SNI)</FieldLabel>
          <TextInput
            :id="ids.servername"
            v-model="draft.tls.servername"
            :placeholder="draft.host.trim() || 'Same as the host'"
            maxlength="255"
            :aria-invalid="errors.servername ? true : undefined"
            class="font-mono"
          />
          <FieldError v-if="errors.servername" class="text-xs">{{ errors.servername }}</FieldError>
        </Field>
      </div>

      <Field>
        <FieldLabel :for="ids.alpn">ALPN protocols</FieldLabel>
        <TagsInput
          :model-value="draft.tls.alpnProtocols"
          add-on-paste
          add-on-blur
          delimiter=","
          class="min-h-8 gap-1 rounded-lg border-input-border bg-transparent px-1.5 py-1 shadow-none dark:bg-input/30"
          @update:model-value="onAlpn"
        >
          <TagsInputItem
            v-for="protocol in draft.tls.alpnProtocols"
            :key="protocol"
            :value="protocol"
            class="h-6 rounded-md border bg-muted"
          >
            <TagsInputItemText class="px-1.5 font-mono text-xs" />
            <TagsInputItemDelete
              class="mr-0.5 text-muted-foreground hover:text-foreground [&_svg]:size-3.5"
            />
          </TagsInputItem>
          <TagsInputInput
            :id="ids.alpn"
            placeholder="Add a protocol…"
            class="min-w-28 font-mono text-xs"
          />
        </TagsInput>
        <FieldDescription class="text-xs">
          Press Enter or comma to add, e.g.
          <code class="font-mono text-[11px] text-foreground/80">x-amzn-mqtt-ca</code> for AWS IoT
          on port 443.
        </FieldDescription>
      </Field>

      <SecretStorageNote subject="Passphrases" />
    </FieldGroup>
  </div>
</template>
