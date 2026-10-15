/**
 * Built-in widget registry. To add a widget type: create a file in this
 * directory exporting a WidgetProvider, then register it here — that's the
 * whole integration. See CONTRIBUTING.md for the walkthrough.
 */
import { registerProvider } from '@panodash/widget-sdk/registry';
import { clockProvider } from './clock';
import { weatherProvider } from './weather';
import { manualMetricProvider } from './manualMetric';
import { restApiProvider } from './restApi';
import { linearTasksProvider } from './linearTasks';
import { ouraProvider } from './oura';
import { fitbitProvider } from './fitbit';
import { withingsProvider } from './withings';
import { whoopProvider } from './whoop';
import { computedProvider } from './computed';
import { rssFeedProvider } from './rssFeed';
import { githubStarsProvider } from './githubStars';
import { githubReviewsProvider } from './githubReviews';
import { githubBranchHealthProvider } from './githubBranchHealth';
import { githubMyPrsProvider } from './githubMyPrs';
import { githubMilestoneProvider } from './githubMilestone';
import { githubActionsFailuresProvider } from './githubActionsFailures';
import { githubIssueTriageProvider } from './githubIssueTriage';
import { githubReleaseDownloadsProvider } from './githubReleaseDownloads';
import { githubFirstTimeContributorsProvider } from './githubFirstTimeContributors';
import { githubCycleTimeProvider } from './githubCycleTime';
import { githubNotificationsProvider } from './githubNotifications';
import { gitlabStarsProvider } from './gitlabStars';
import { gitlabReviewsProvider } from './gitlabReviews';
import { gitlabBranchHealthProvider } from './gitlabBranchHealth';
import { gitlabMyMrsProvider } from './gitlabMyMrs';
import { gitlabMilestoneProvider } from './gitlabMilestone';
import { gitlabPipelineFailuresProvider } from './gitlabPipelineFailures';
import { gitlabIssueTriageProvider } from './gitlabIssueTriage';
import { gitlabReleaseAssetsProvider } from './gitlabReleaseAssets';
import { gitlabFirstTimeContributorsProvider } from './gitlabFirstTimeContributors';
import { gitlabCycleTimeProvider } from './gitlabCycleTime';
import { gitlabTodosProvider } from './gitlabTodos';
import { githubDependabotAlertsProvider } from './githubDependabotAlerts';
import { githubTrafficProvider } from './githubTraffic';
import { githubCoverageTrendProvider } from './githubCoverageTrend';

let registered = false;

export function registerBuiltins(): void {
  if (registered) return;
  registered = true;
  registerProvider(clockProvider);
  registerProvider(weatherProvider);
  registerProvider(manualMetricProvider);
  registerProvider(restApiProvider);
  registerProvider(linearTasksProvider);
  registerProvider(ouraProvider);
  registerProvider(fitbitProvider);
  registerProvider(withingsProvider);
  registerProvider(whoopProvider);
  registerProvider(computedProvider);
  registerProvider(rssFeedProvider);
  registerProvider(githubStarsProvider);
  registerProvider(githubReviewsProvider);
  registerProvider(githubBranchHealthProvider);
  registerProvider(githubMyPrsProvider);
  registerProvider(githubMilestoneProvider);
  registerProvider(githubActionsFailuresProvider);
  registerProvider(githubIssueTriageProvider);
  registerProvider(githubReleaseDownloadsProvider);
  registerProvider(githubFirstTimeContributorsProvider);
  registerProvider(githubCycleTimeProvider);
  registerProvider(githubNotificationsProvider);
  registerProvider(gitlabStarsProvider);
  registerProvider(gitlabReviewsProvider);
  registerProvider(gitlabBranchHealthProvider);
  registerProvider(gitlabMyMrsProvider);
  registerProvider(gitlabMilestoneProvider);
  registerProvider(gitlabPipelineFailuresProvider);
  registerProvider(gitlabIssueTriageProvider);
  registerProvider(gitlabReleaseAssetsProvider);
  registerProvider(gitlabFirstTimeContributorsProvider);
  registerProvider(gitlabCycleTimeProvider);
  registerProvider(gitlabTodosProvider);
  registerProvider(githubDependabotAlertsProvider);
  registerProvider(githubTrafficProvider);
  registerProvider(githubCoverageTrendProvider);
}
