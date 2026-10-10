import type { ComponentProps } from 'react'
import ManagementDialog from '@/app/components/ui/ManagementDialog'

/** Existing Promise surface keeps its naming, safe retry guidance and focus destination. */
export default function PromiseManagementDialog(props: Omit<ComponentProps<typeof ManagementDialog>, 'closeLabel' | 'blockedMessage' | 'returnFocusSelector'>) {
 return <ManagementDialog {...props} closeLabel="Close promise management" returnFocusSelector="[data-promise-heading]"
   blockedMessage="Keep this panel open until the save is confirmed. An uncertain response can be retried safely with the same details." />
}
