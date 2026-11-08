<script setup lang="ts">
/**
 * Authentication: username and password (encrypted at rest when the system allows it). Both
 * are limited to 65,535 UTF-8 bytes like the main process checks them.
 */
import { useId } from 'vue'
import { Field, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field'
import { useConnectionForm } from '../../composables/useConnectionForm'
import PasswordInput from '../fields/PasswordInput.vue'
import SecretStorageNote from '../fields/SecretStorageNote.vue'
import SectionHeader from '../fields/SectionHeader.vue'
import TextInput from '../fields/TextInput.vue'

const { draft, errors } = useConnectionForm()
const ids = { username: useId(), password: useId() }
</script>

<template>
  <div class="flex flex-col gap-6">
    <SectionHeader section="auth" />
    <FieldGroup class="gap-5">
      <div class="grid gap-4 sm:grid-cols-2">
        <Field :data-invalid="errors.username ? true : undefined">
          <FieldLabel :for="ids.username">Username</FieldLabel>
          <TextInput
            :id="ids.username"
            v-model="draft.username"
            data-testid="connection-username"
            placeholder="Anonymous"
            :aria-invalid="errors.username ? true : undefined"
            class="font-mono"
          />
          <FieldError v-if="errors.username" class="text-xs">{{ errors.username }}</FieldError>
        </Field>
        <Field :data-invalid="errors.password ? true : undefined">
          <FieldLabel :for="ids.password">Password</FieldLabel>
          <PasswordInput
            :id="ids.password"
            v-model="draft.password"
            data-testid="connection-password"
            placeholder="None"
            :aria-invalid="errors.password ? true : undefined"
          />
          <FieldError v-if="errors.password" class="text-xs">{{ errors.password }}</FieldError>
        </Field>
      </div>
      <SecretStorageNote />
    </FieldGroup>
  </div>
</template>
