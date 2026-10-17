/** Where the project lives. Update if the repository moves (PLAN.md §14 Q3). */
export const REPO_URL = 'https://github.com/mishraprayash/ctx-lint';

export function ruleDocsUrl(ruleId: string): string {
  return `${REPO_URL}/blob/main/docs/rules/${ruleId}.md`;
}
