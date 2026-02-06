# Security Gate Checklist (Paste into PR)

- [ ] All DB queries are parameterized (no string interpolation).
- [ ] No interpolated SQL (template strings / concatenation).
- [ ] Tenant scoping present on all tenant-owned queries.
- [ ] Input validation at route/controller boundary.
- [ ] Raw SQL (if any) uses placeholders + params array.
- [ ] Dynamic identifiers are allowlisted (if used).
- [ ] No secret/PII logging (tokens, cookies, API keys, bodies).
- [ ] Least-privilege DB role usage verified.
- [ ] `pnpm security:sqlcheck` run (or explain why not).

## Minimal Proof Snippets (Examples)

**Parameterized query (safe)**
```
// Example only: use query builder or parameter bindings
const { data, error } = await supabase
  .from('notes')
  .select('id, content')
  .eq('user_id', userId)
```

**Tenant scoping (required)**
```
// Example only: always scope by tenant/user_id
.from('subscriptions')
.eq('user_id', user.id)
```
