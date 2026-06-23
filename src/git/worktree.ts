import fs from 'node:fs';
import path from 'node:path';
import { runCommand } from '../utils.js';

export interface WorktreeSpec {
  path: string;
  branch: string;
}

export class WorktreeManager {
  private worktrees: WorktreeSpec[] = [];

  constructor(
    private repoRoot: string,
    private runId: string,
  ) {}

  get worktreeDir(): string {
    return path.join(this.repoRoot, '.aeon', 'worktrees', this.runId);
  }

  /**
   * Create a new worktree for a section or integration branch.
   */
  async create(slug: string, startPoint: string): Promise<WorktreeSpec> {
    const branch = `aeon/${this.runId}/${slug}`;
    const wtPath = path.join(this.worktreeDir, slug);

    fs.mkdirSync(path.dirname(wtPath), { recursive: true });

    await runCommand('git', [
      '-C', this.repoRoot,
      'worktree', 'add',
      '-b', branch,
      wtPath,
      startPoint,
    ]);

    const spec: WorktreeSpec = { path: wtPath, branch };
    this.worktrees.push(spec);
    return spec;
  }

  /**
   * Stage and commit any dirty files in a worktree.
   * Returns true if a commit was made.
   */
  async commitIfDirty(wtPath: string, message: string): Promise<boolean> {
    const status = await runCommand('git', ['-C', wtPath, 'status', '--porcelain']);
    if (!status.stdout.trim()) return false;

    await runCommand('git', ['-C', wtPath, 'add', '-A']);
    const commit = await runCommand(
      'git',
      ['-C', wtPath, 'commit', '-m', message],
      { allowFailure: true },
    );
    if (commit.code === 0) return true;

    const combined = `${commit.stdout}\n${commit.stderr}`.toLowerCase();
    if (combined.includes('nothing to commit') || combined.includes('no changes added to commit')) {
      return false;
    }
    return false;
  }

  /**
   * Merge a section branch into the integration worktree.
   * Returns 'merged' | 'auto_resolved' | 'conflict'.
   */
  async mergeBranch(
    integrationPath: string,
    sectionBranch: string,
    message: string,
  ): Promise<'merged' | 'auto_resolved' | 'conflict'> {
    // First try standard merge
    const merge = await runCommand(
      'git',
      ['-C', integrationPath, 'merge', sectionBranch, '-m', message],
      { allowFailure: true },
    );

    if (merge.code === 0) return 'merged';

    // Abort the failed merge
    await runCommand('git', ['-C', integrationPath, 'merge', '--abort'], { allowFailure: true });

    // Retry with -X theirs (section wins)
    const retry = await runCommand(
      'git',
      ['-C', integrationPath, 'merge', '-X', 'theirs', sectionBranch, '-m', `${message} (auto-resolved)`],
      { allowFailure: true },
    );

    if (retry.code === 0) return 'auto_resolved';

    // Give up — abort and report conflict
    await runCommand('git', ['-C', integrationPath, 'merge', '--abort'], { allowFailure: true });
    return 'conflict';
  }

  /**
   * Count changed files in a worktree vs its parent commit.
   */
  async countChangedFiles(wtPath: string): Promise<number> {
    const result = await runCommand(
      'git',
      ['-C', wtPath, 'diff', '--name-only', 'HEAD~1'],
      { allowFailure: true },
    );
    if (result.code !== 0) return 0;
    return result.stdout.trim().split('\n').filter(Boolean).length;
  }

  /**
   * Remove only per-section worktrees, keeping the merged integration worktree.
   */
  async cleanupSectionWorktrees(): Promise<void> {
    const remaining: WorktreeSpec[] = [];

    for (const wt of this.worktrees) {
      const slug = path.basename(wt.path);
      if (slug === 'integration') {
        remaining.push(wt);
        continue;
      }
      await this.removeWorktree(wt.path);
    }

    this.worktrees = remaining;
    await runCommand(
      'git',
      ['-C', this.repoRoot, 'worktree', 'prune'],
      { allowFailure: true },
    );
  }

  /**
   * Remove all worktrees and prune.
   */
  async cleanup(): Promise<void> {
    for (const wt of this.worktrees) {
      await this.removeWorktree(wt.path);
    }
    await runCommand(
      'git',
      ['-C', this.repoRoot, 'worktree', 'prune'],
      { allowFailure: true },
    );
    this.worktrees = [];

    // Remove the worktree directory
    const dir = this.worktreeDir;
    if (fs.existsSync(dir)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }

  private async removeWorktree(wtPath: string): Promise<void> {
    await runCommand(
      'git',
      ['-C', this.repoRoot, 'worktree', 'remove', '--force', wtPath],
      { allowFailure: true },
    );
  }
}
