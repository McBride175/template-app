'use client'

import { useId } from 'react'
import Button from '@/app/components/ui/Button'
import Field from '@/app/components/ui/Field'
import Input from '@/app/components/ui/Input'
import Textarea from '@/app/components/ui/Textarea'
import Spinner from '@/app/components/ui/Spinner'
import Alert from '@/app/components/ui/Alert'
import type { ActionHistoryOutcome } from '@/lib/collections/action-history'

export const OUTCOME_OPTIONS: Array<{ value: ActionHistoryOutcome; label: string }> = [
  { value: 'no_response', label: 'No response' },
  { value: 'message_sent', label: 'Message sent' },
  { value: 'responded_no_commitment', label: 'Responded — no commitment' },
  { value: 'reviewed_no_chase', label: 'Reviewed — no chase needed' },
]
export type FollowUpChoice = 'tomorrow' | 'two_days' | 'three_days' | 'next_week' | 'custom'

export interface QueueActionPanelProps {
  disabled: boolean
  saving: boolean
  uncertain: boolean
  followUp: FollowUpChoice
  followUpLabel: string
  showFollowUp: boolean
  datesAvailable: boolean
  minimumDate?: string
  customDate: string
  showNote: boolean
  note: string
  firstActionGuidance?: boolean
  onRecord: (outcome: ActionHistoryOutcome) => void
  onRetry: () => void
  onToggleFollowUp: () => void
  onFollowUp: (choice: FollowUpChoice) => void
  onCustomDate: (value: string) => void
  onShowNote: () => void
  onNote: (value: string) => void
}

// Controlled presentation of the existing choices; owns no request or action state.
export default function QueueActionPanel(props: QueueActionPanelProps) {
  const dateId = useId(), noteId = useId(), choicesId = useId()
  const locked = props.disabled || props.uncertain
  return <section aria-label="Record collection outcome" className="flex flex-col gap-3">
    {props.firstActionGuidance && <Alert variant="info">
      <p className="hidden font-semibold sm:block">Work the priority, then record what happened.</p>
      <p className="sm:hidden">Record an outcome to update the queue and set the next follow-up.</p>
      <p className="hidden sm:block">Recording an outcome sets the next follow-up date and updates the active queue.</p>
    </Alert>}
    <div>
      <h3 className="text-base font-semibold sm:text-lg">What happened?</h3>
      <p className="mt-1 hidden text-sm text-text-secondary sm:block">Record the outcome after working this customer.</p>
    </div>
    <div className="border-y border-border-default py-1">
      <Button variant="ghost" className="min-h-11 w-full justify-between gap-3 px-0 text-left font-normal"
        onClick={props.onToggleFollowUp} disabled={locked} aria-expanded={props.showFollowUp} aria-controls={choicesId}>
        <span>Do not follow up until: <strong className="font-semibold text-text-primary">{props.followUpLabel}</strong></span>
        <span className="text-xs font-semibold">{props.showFollowUp ? 'Close' : 'Change'}</span>
      </Button>
      <div id={choicesId} hidden={!props.showFollowUp} className="space-y-3 pb-3">
        <div className="flex flex-wrap gap-2" role="group" aria-label="Follow-up timing">
          {([
            ['tomorrow', 'Tomorrow'], ['two_days', 'In 2 days'], ['three_days', 'In 3 days'],
            ['next_week', 'Next week'], ['custom', 'Choose date'],
          ] as const).map(([choice, label]) => <Button key={choice} size="sm" className="min-h-11"
            variant={props.followUp === choice ? 'primary' : 'secondary'} aria-pressed={props.followUp === choice}
            onClick={() => props.onFollowUp(choice)} disabled={locked || !props.datesAvailable}>{label}</Button>)}
        </div>
        {props.followUp === 'custom' && <Field id={dateId} label="Date">
          {control => <Input {...control} type="date" min={props.minimumDate} value={props.customDate}
            onChange={event => props.onCustomDate(event.target.value)} disabled={locked} className="min-h-11" />}
        </Field>}
      </div>
    </div>
    {!props.showNote ? <Button variant="ghost" className="order-2 min-h-11 self-start px-0 sm:order-none" onClick={props.onShowNote} disabled={locked}>Add note</Button>
      : <Field id={noteId} label="Note (optional)" hint={`${props.note.length}/2,000 characters`}>
        {control => <Textarea {...control} autoFocus rows={3} maxLength={2000} value={props.note}
          onChange={event => props.onNote(event.target.value)} disabled={locked} placeholder="What should you remember next time?" />}
      </Field>}
    <div className="grid gap-2 sm:grid-cols-2" role="group" aria-label="Record outcome">
      {OUTCOME_OPTIONS.map(option => <Button key={option.value} variant="secondary" className="min-h-11 w-full whitespace-normal text-center"
        onClick={() => props.onRecord(option.value)} disabled={locked || (props.followUp === 'custom' && !props.customDate)}>
        {props.saving ? <><Spinner label={null} /> Saving…</> : option.label}
      </Button>)}
    </div>
    {props.uncertain && <Button variant="primary" className="min-h-11" onClick={props.onRetry} disabled={props.disabled}>Retry save</Button>}
  </section>
}
