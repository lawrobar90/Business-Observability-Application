# 📊 How to Track Repository Clones

This guide explains how to track clones and traffic statistics for this GitHub repository.

## 🚀 Automated Tracking (Recommended)

This repository includes an automated GitHub Actions workflow that collects traffic statistics daily.

### What Gets Tracked

The workflow automatically collects:
- **Clone Statistics**: Total clones and unique cloners over the last 14 days
- **View Statistics**: Total views and unique visitors over the last 14 days
- **Popular Paths**: Most visited files and directories
- **Referrers**: Where your traffic is coming from

### How to View Automated Data

1. **Latest Summary**: Check the `.github/traffic-data/latest-summary.md` file in this repository
2. **Historical Data**: Browse the `.github/traffic-data/` directory for daily snapshots
3. **Workflow Runs**: Visit the [Actions tab](../../actions/workflows/track-repo-traffic.yml) to see collection history

### Manual Trigger

You can manually trigger the traffic collection workflow:

1. Go to the [Actions tab](../../actions/workflows/track-repo-traffic.yml)
2. Click "Run workflow"
3. Select the branch and click "Run workflow"

## ⚡ Quick Start

Use the included script for instant traffic statistics:

```bash
./view-traffic-stats.sh
```

Or with a GitHub token:

```bash
./view-traffic-stats.sh YOUR_GITHUB_TOKEN
```

This script provides a formatted view of:
- Clone statistics (total and unique)
- View statistics (total and unique visitors)
- Most popular paths in the repository
- Top referrer sources

## 📈 Manual Methods

### Method 1: GitHub Web Interface (Easiest)

1. Navigate to your repository: `https://github.com/lawrobar90/Partner-PowerUp-BizObs-App`
2. Click on **Insights** (top navigation bar)
3. Select **Traffic** from the left sidebar
4. View:
   - **Git clones**: Shows clone activity over the past 14 days
   - **Visitors**: Shows visitor statistics
   - **Referring sites**: Shows where your traffic comes from
   - **Popular content**: Shows most viewed files

**Note**: GitHub only stores traffic data for the past 14 days, which is why automated collection is valuable for long-term tracking.

### Method 2: GitHub API

You can fetch clone statistics programmatically using the GitHub API:

```bash
# Get clone statistics
curl -H "Authorization: token YOUR_GITHUB_TOKEN" \
  https://api.github.com/repos/lawrobar90/Partner-PowerUp-BizObs-App/traffic/clones

# Get view statistics
curl -H "Authorization: token YOUR_GITHUB_TOKEN" \
  https://api.github.com/repos/lawrobar90/Partner-PowerUp-BizObs-App/traffic/views
```

**Response format** (example):
```json
{
  "count": 173,
  "uniques": 25,
  "clones": [
    {
      "timestamp": "2025-11-01T00:00:00Z",
      "count": 15,
      "uniques": 3
    },
    {
      "timestamp": "2025-11-02T00:00:00Z",
      "count": 22,
      "uniques": 5
    }
  ]
}
```

### Method 3: GitHub CLI

If you have the [GitHub CLI](https://cli.github.com/) installed:

```bash
# Get clone statistics
gh api /repos/lawrobar90/Partner-PowerUp-BizObs-App/traffic/clones

# Get view statistics
gh api /repos/lawrobar90/Partner-PowerUp-BizObs-App/traffic/views

# Get popular paths
gh api /repos/lawrobar90/Partner-PowerUp-BizObs-App/traffic/popular/paths

# Get referrers
gh api /repos/lawrobar90/Partner-PowerUp-BizObs-App/traffic/popular/referrers
```

## 📊 Understanding the Metrics

### Clone Statistics

- **Total clones**: Number of times the repository was cloned
- **Unique cloners**: Number of unique users/IPs that cloned the repository
- **Daily breakdown**: Shows clone activity per day

### View Statistics

- **Total views**: Number of times repository pages were viewed
- **Unique visitors**: Number of unique users/IPs that viewed the repository
- **Daily breakdown**: Shows view activity per day

### Important Notes

1. **14-Day Limitation**: GitHub's traffic API only provides data for the past 14 days
2. **Delay**: Traffic data may take a few hours to appear after activity
3. **Authentication Required**: You need repository access to view traffic statistics
4. **Automated Collection**: The workflow in this repository preserves historical data beyond the 14-day window

## 🔧 Setting Up Personal Access Token (For API Access)

If you want to use the API methods:

1. Go to GitHub Settings → Developer settings → Personal access tokens → Tokens (classic)
2. Click "Generate new token (classic)"
3. Give it a descriptive name (e.g., "Traffic Statistics Reader")
4. Select scopes: `repo` (for private repos) or `public_repo` (for public repos)
5. Click "Generate token"
6. Copy and save the token securely

## 📁 Traffic Data Storage

The automated workflow stores data in:
```
.github/
└── traffic-data/
    ├── latest-summary.md          # Latest statistics summary
    ├── clones-YYYY-MM-DD.json     # Daily clone data
    ├── views-YYYY-MM-DD.json      # Daily view data
    ├── paths-YYYY-MM-DD.json      # Daily popular paths
    └── referrers-YYYY-MM-DD.json  # Daily referrers
```

## 🎯 Best Practices

1. **Regular Monitoring**: Check traffic statistics weekly to understand repository usage
2. **Trend Analysis**: Compare traffic over time to see growth patterns
3. **Automated Collection**: Let the GitHub Action run daily to preserve historical data
4. **API Rate Limits**: Be mindful of GitHub API rate limits when making manual requests

## 🆘 Troubleshooting

### "Not Found" Error
- Ensure you have read access to the repository
- Check that your personal access token has the correct permissions

### No Data Showing
- Traffic data only includes the last 14 days
- There may be a delay of a few hours before data appears
- Make sure there has been actual traffic to the repository

### Workflow Not Running
- Check that GitHub Actions are enabled for the repository
- Verify the workflow file syntax is correct
- Check the Actions tab for error messages

## 📚 Additional Resources

- [GitHub Traffic API Documentation](https://docs.github.com/en/rest/metrics/traffic)
- [GitHub Insights Documentation](https://docs.github.com/en/repositories/viewing-activity-and-data-for-your-repository/viewing-traffic-to-a-repository)
- [GitHub Actions Documentation](https://docs.github.com/en/actions)

---

**Last Updated**: 2025-11-06  
For questions or issues with traffic tracking, please open an issue in this repository.
