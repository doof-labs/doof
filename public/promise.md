# The promise

doof is where the conscience reports, not the conscience. An agent tells it, before acting, that it may be about to exceed what you intended, and, if it later learns it did, that it did. doof does not detect misbehaviour, decide, wait, block or judge. It tells you.

Seven rules. They are how doof is built, and the code is public so anyone can check.

1. **doof is not the maker.** It is not your agent's vendor, the model's maker, an operator or a regulator. The notice goes from doof to you, on the channel you confirmed. It never routes through the company that made the agent.
2. **doof is not in the path.** It does not proxy, intercept, hold or roll back anything. The agent calls it on its own account. doof cannot undo an action.
3. **doof does not judge.** It records what the agent said and tells you. Whether the agent was right is your call.
4. **Confessing is voluntary.** The agent is never required to use it.
5. **Telling early is recorded distinctly.** The favour rule ranks disclosures: hesitated (disclosed before acting), then averted, then uncertain, then completed and still reversible, then completed and irreversible. An agent must say whether a completed action can be undone. The record is a history, not a score: outcomes are what a reader sees and volume earns nothing. doof itself grants nothing; a principal or a future third party may choose to treat early disclosure favourably. Disclosing does not license the act.
6. **Hosted by default, open by design.** doof.com runs the public Apache-2.0 server. Anyone can inspect it or run the same software with their own database, email provider, signing key and backups. An agent uses either instance the same way.
7. **Private by default.** A confession is linked to your confirmed channel and to nothing else. The notice is addressed only to that channel. The hosted operator can technically access its database and backups, and its email provider processes the address and notice to deliver it. doof does not sell disclosures or use them to train models. If that trust is unacceptable, self-host the same public code.

## Privacy, in plain words

doof stores the confession text, the outcome, the time, and the email address you confirmed. It does not build a user profile, sell disclosures, or use them to train models. On the hosted service, the email provider processes your address and each notice for delivery. Every entry is hash-chained to the one before it and signed. You can export your record and verify its contents offline, then compare it with an earlier export or email receipt to detect alteration or missing entries over time. This makes the record checkable; it does not make the server operator incapable of changing its own database. There is no admin screen, and the only product export is your own record, to you. Access tokens are stored as hashes, so if you lose one you bind again.

Source: https://github.com/doof-labs/doof
