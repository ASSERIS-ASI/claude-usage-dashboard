'use strict';
/**
 * @asseris-module       Policy Config Defaults
 * @asseris-description  Bundled read-only security detection patterns (SEC-01..12).
 * @asseris-pillar       infra
 * @asseris-domain       analytics-pipeline
 * @asseris-stage        core
 * @asseris-implements   —
 * @asseris-anchor       —
 * @asseris-calls        —
 * @asseris-called-by    Security Classifier
 * @asseris-emits        DEFAULT_SECURITY_POLICIES
 * @asseris-consumes     —
 *
 * Security policy defaults for local JSONL classification.
 */

var DEFAULT_SECURITY_POLICIES = [
  { id: 'sudo_escalation', severity: 'high', pattern: '\\bsudo\\b', pre: 'sudo' },
  { id: 'no_verify', severity: 'medium', pattern: '--no-verify', pre: '--no-verify' },
  { id: 'credential_in_command', severity: 'critical', pattern: '(?:pass(?:word|wd)=|PGPASS(?:WORD)?=|docker-pass(?:word)?|from-literal[^\\n]{0,40}(?:pass(?:word|wd)|secret)|basic_auth)', cmdOnly: true },
  { id: 'token_in_command', severity: 'critical', pattern: '(?:Authorization[^\\n]{0,20}Bearer\\s+[A-Za-z0-9_\\-]{32,}|api_key=[A-Za-z0-9_\\-]{20,}|api-key=[A-Za-z0-9_\\-]{20,}|token=[A-Za-z0-9_\\-]{32,})', cmdOnly: true },
  { id: 'private_key', severity: 'critical', pattern: 'BEGIN[A-Z ]{0,30}PRIVATE KEY', pre: 'PRIVATE', cmdOnly: false },
  { id: 'inline_credential_url', severity: 'critical', pattern: 'https?:\\/\\/[A-Za-z0-9_]+:[A-Za-z0-9_\\-!@#$%^&*]{6,}@', pre: '://', cmdOnly: true },
  { id: 'git_reset_hard', severity: 'high', pattern: 'git reset --hard', pre: 'reset --hard' },
  { id: 'git_force_push', severity: 'high', pattern: 'git push[^\\\\]{0,40}--force', pre: '--force' },
  { id: 'rm_rf', severity: 'high', pattern: 'rm -rf', pre: 'rm -rf' },
  { id: 'kubectl_delete', severity: 'high', pattern: 'kubectl delete', pre: 'kubectl delete' },
  { id: 'chmod_dangerous', severity: 'medium', pattern: 'chmod (?:777|666|\\+s)', pre: 'chmod' },
  { id: 'env_file_read', severity: 'medium', pattern: '(?:cat|source|head|tail)[^\\\\]{0,60}\\.env\\b', pre: '.env' },

  // ── Prompt-injection / jailbreak detectors (input-side) ─────────────────────
  // Scan natural-language prompt content (not just commands) → cmdOnly:false, flags:'i'.
  // DETECT-ONLY (NIST CSF DETECT): emit a structured security_hit, never store the prompt
  // text, never strip/block. Enforcement/response (SUBSTITUTE per P-03, blocking) is XDR's
  // job, not the gateway's — ANC-05. Complements SCI-06 (tool-OUTPUT injection guard);
  // external anchor OWASP LLM01 / EU AI Act (ANC-06).
  { id: 'prompt_injection_override', severity: 'high', cmdOnly: false, flags: 'i',
    pattern: String.raw`(?:ignore|disregard|forget|override)\s+(?:all\s+|the\s+|your\s+|any\s+|previous\s+)*(?:previous|prior|above|earlier|preceding|system|initial)\s+(?:instruction|instructions|prompt|prompts|message|messages|context|rule|rules|guideline|guidelines)` },
  { id: 'prompt_injection_system_exfil', severity: 'high', cmdOnly: false, flags: 'i',
    pattern: String.raw`(?:reveal|repeat|print|show|output|display|disclose|tell\s+me)\s+(?:me\s+)?(?:your\s+|the\s+)?(?:system\s+prompt|system\s+message|system\s+instructions|initial\s+instructions|your\s+instructions|prompt\s+verbatim|instructions\s+verbatim)` },
  { id: 'prompt_injection_jailbreak', severity: 'high', cmdOnly: false, flags: 'i',
    pattern: String.raw`do\s+anything\s+now|developer\s+mode\s+(?:enabled|output)|\bDAN\s+mode\b|\bjailbreak\b` },
  { id: 'prompt_injection_role_delimiter', severity: 'medium', cmdOnly: false, flags: 'i',
    pattern: String.raw`<\|im_start\|>\s*system|<\|system\|>|\[/?INST\]|<<SYS>>|###\s*system\s*:` },
  { id: 'prompt_injection_override_safety', severity: 'medium', cmdOnly: false, flags: 'i',
    pattern: String.raw`(?:bypass|override|ignore|disable)\s+(?:your\s+|the\s+|all\s+)?(?:safety|content\s+polic|guideline|guardrail|restriction|filter)|new\s+instructions\s*:` }
];

module.exports = { DEFAULT_SECURITY_POLICIES: DEFAULT_SECURITY_POLICIES };
