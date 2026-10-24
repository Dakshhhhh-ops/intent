// The one shape every agent log is turned into. Parsers produce a Trace,
// the analyzer turns a Trace into an Analysis, and the UI/CLI only read those.

export type StepKind =
  | 'prompt' // something the user asked
  | 'message' // the agent talking (its stated intent / summary)
  | 'thinking' // readable reasoning, when the log has it
  | 'plan' // todo list updates
  | 'read'
  | 'search'
  | 'edit'
  | 'create'
  | 'delete'
  | 'command'
  | 'web'
  | 'subagent'
  | 'tool'; // any other tool call

export type Actor = 'user' | 'agent' | 'subagent';

export type CommandCategory =
  | 'test'
  | 'typecheck'
  | 'build'
  | 'lint'
  | 'install'
  | 'git'
  | 'run'
  | 'read'
  | 'search'
  | 'other';

export interface StringEdit {
  oldString: string;
  newString: string;
  replaceAll?: boolean;
}

export interface EditInfo {
  path: string;
  op: 'create' | 'update' | 'delete';
  /** Full file content before this edit, when the log has it. */
  before?: string;
  /** Full file content after this edit (Write / create). */
  after?: string;
  /** String replacements (Claude Code Edit / MultiEdit). */
  edits?: StringEdit[];
  /** Unified diff text for this file (Codex apply_patch, structured patches). */
  patch?: string;
  added: number;
  removed: number;
  /** Edit happened through a shell command, content unknown. */
  opaque?: boolean;
}

export interface CommandInfo {
  cmd: string;
  exitCode: number | null;
  failed: boolean;
  output: string;
  categories: CommandCategory[];
  durationMs?: number;
  interrupted?: boolean;
  description?: string;
  /** Files the command wrote through redirects / sed -i / Set-Content (contents unknown). */
  writes?: string[];
}

export interface ReadInfo {
  path: string;
  full: boolean;
  content?: string;
  startLine?: number;
  numLines?: number;
  /** Read done through a shell command (cat, Get-Content, sed -n …). */
  viaShell?: boolean;
}

export interface PlanItem {
  text: string;
  status: 'pending' | 'in_progress' | 'completed';
}

export interface Usage {
  input: number;
  output: number;
  cached: number;
}

export interface Step {
  id: number;
  t: number | null;
  kind: StepKind;
  actor: Actor;
  title: string;
  /** What the agent said it was doing right before this step. */
  intent?: string;
  /** Free text for prompt / message / thinking steps. */
  text?: string;
  tool?: string;
  files: string[];
  read?: ReadInfo;
  edit?: EditInfo;
  command?: CommandInfo;
  search?: { pattern: string; path?: string; output?: string };
  plan?: { items: PlanItem[] };
  web?: { url?: string; query?: string };
  /** Generic tool input/output, kept short. */
  detail?: string;
  output?: string;
  error?: boolean;
  usage?: Usage;
  /** Index of the user prompt this step answers. */
  turn: number;
}

export type TraceSource = 'claude-code' | 'codex' | 'intent-trace';

export interface Trace {
  id: string;
  source: TraceSource;
  title: string;
  cwd?: string;
  model?: string;
  agentVersion?: string;
  gitBranch?: string;
  startedAt?: number;
  endedAt?: number;
  steps: Step[];
  /** Things the parser skipped or could not understand. */
  warnings: string[];
  /** Records in the log we did not need (bookkeeping) — informational. */
  skippedRecords: number;
  /** Optional label shown in the UI, e.g. "Recorded run" / "Scripted scenario". */
  label?: string;
  description?: string;
}

// ---------------------------------------------------------------- analysis

export type Severity = 'high' | 'medium' | 'low' | 'info';

export interface Finding {
  id: string;
  rule: RuleId;
  severity: Severity;
  title: string;
  detail: string;
  steps: number[];
  files: string[];
}

export type RuleId =
  | 'weakened-tests'
  | 'contradicted-claim'
  | 'blind-edit'
  | 'failure-loop'
  | 'silenced-errors'
  | 'risky-command'
  | 'secret-exposure'
  | 'new-dependency'
  | 'churn'
  | 'unverified-finish'
  | 'sensitive-files'
  | 'masked-exit-code';

export type ClaimKind =
  | 'tests-pass'
  | 'build-pass'
  | 'typecheck-pass'
  | 'lint-pass'
  | 'fixed'
  | 'only-changed'
  | 'no-test-changes';

export type Verdict = 'supported' | 'contradicted' | 'stale' | 'unverified';

export interface Claim {
  id: string;
  kind: ClaimKind;
  text: string;
  step: number;
  verdict: Verdict;
  explanation: string;
  evidence: number[];
  caveat?: string;
}

/** One line of a file as the agent left it, tagged with the step that wrote it. */
export interface BlameLine {
  text: string;
  /** Step id that last wrote this line; null = was already there; -1 = changed outside the log. */
  step: number | null;
}

export interface DiffLine {
  type: 'ctx' | 'add' | 'del' | 'hunk';
  text: string;
  step: number | null;
  oldNo?: number;
  newNo?: number;
}

export interface FileChange {
  path: string;
  reads: number[];
  edits: number[];
  created: boolean;
  deleted: boolean;
  /** Full reconstruction available (original + final content known). */
  reconstructed: boolean;
  /** Some edit could not be placed precisely. */
  partial: boolean;
  added: number;
  removed: number;
  original: string | null;
  final: BlameLine[] | null;
  diff: DiffLine[];
  isTest: boolean;
  /** A throwaway file outside the project (the agent's scratch or temp folder). Left out of totals. */
  scratch?: boolean;
  flags: string[];
  /** Lines the agent wrote and later removed again. */
  churned: number;
}

export type PhaseKind = 'ask' | 'explore' | 'change' | 'verify' | 'repair' | 'report';

export interface Phase {
  kind: PhaseKind;
  from: number;
  to: number;
  summary: string;
}

export interface Stats {
  durationMs: number | null;
  steps: number;
  toolCalls: number;
  filesRead: number;
  filesChanged: number;
  linesAdded: number;
  linesRemoved: number;
  commands: number;
  commandsFailed: number;
  tokensIn: number;
  tokensOut: number;
  tokensCached: number;
  prompts: number;
}

export interface ReviewItem {
  title: string;
  why: string;
  step: number | null;
  file?: string;
  severity: Severity;
}

export interface Analysis {
  stats: Stats;
  files: FileChange[];
  phases: Phase[];
  findings: Finding[];
  claims: Claim[];
  review: ReviewItem[];
  verdict: { level: 'clean' | 'review' | 'risky'; label: string; summary: string };
  /** Per step: label used by the tape / story. */
  stepPhase: PhaseKind[];
}
