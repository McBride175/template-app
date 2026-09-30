-- Preserve historical contact/postponement rows while admitting a distinct,
-- strictly shaped customer-level outcome format. No legacy row is rewritten
-- except to record the provider that already produced it.
alter table public.collection_actions
  add column source_system text not null default 'xero',
  add column note text;

alter table public.collection_actions
  add constraint collection_actions_source_system_xero_check
    check (source_system = 'xero'),
  add constraint collection_actions_note_length_check
    check (note is null or char_length(note) <= 2000);

alter table public.collection_actions
  drop constraint collection_actions_action_type_check,
  drop constraint collection_actions_outcome_check;

alter table public.collection_actions
  add constraint collection_actions_format_check check (
    (
      action_type = 'outcome'
      and outcome is not null
      and outcome in ('no_response', 'message_sent', 'responded_no_commitment', 'reviewed_no_chase')
      and next_action_date is not null
      and isfinite(next_action_date)
      and btrim(tenant_id) <> ''
      and btrim(customer_source_id) <> ''
    )
    or (
      action_type in ('called', 'emailed', 'postponed')
      and (outcome is null or outcome in ('no_response', 'spoke_to_customer', 'promised_to_pay', 'disputed'))
    )
  );

-- One index serves latest-action and keyset-paginated customer history reads.
create index idx_collection_actions_v1_customer_history
  on public.collection_actions
    (user_id, tenant_id, source_system, customer_source_id, action_timestamp desc, id desc)
  where action_type = 'outcome';

-- Existing server-only grants and user-erasure cascade are unchanged.
