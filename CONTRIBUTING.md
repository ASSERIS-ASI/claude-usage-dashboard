# Contributing

1. Create a focused branch.
2. Keep all evidence adapters read-only.
3. Add synthetic fixtures only; never commit real session or proxy logs.
4. Run:

   ```bash
   npm ci
   npm run ci
   ```

5. Open a pull request describing user-visible changes and data assumptions.

Contributions must preserve the public-product boundary: no traffic proxy,
request rewriting, certificate interception, account control, remote log sync
or private deployment configuration.
