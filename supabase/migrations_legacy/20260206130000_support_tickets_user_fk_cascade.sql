alter table public.support_tickets
  drop constraint if exists support_tickets_user_id_fkey;

alter table public.support_tickets
  add constraint support_tickets_user_id_fkey
  foreign key (user_id)
  references auth.users(id)
  on delete cascade;
