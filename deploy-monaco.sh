#!/bin/bash

###############################################################################
# BizObs Monaco Deployment Script
# Deploys self-healing workflows and automation to Dynatrace
###############################################################################

set -e

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
MONACO_DIR="$SCRIPT_DIR/monaco"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}================================================${NC}"
echo -e "${BLUE}   BizObs Monaco Deployment${NC}"
echo -e "${BLUE}================================================${NC}"
echo ""

# Check prerequisites
echo -e "${YELLOW}🔍 Checking prerequisites...${NC}"

# Check if monaco is installed
if ! command -v monaco &> /dev/null; then
    echo -e "${RED}❌ Monaco CLI not found!${NC}"
    echo ""
    echo "Install monaco:"
    echo "  curl -L https://github.com/dynatrace/dynatrace-configuration-as-code/releases/latest/download/monaco-linux-amd64 -o monaco"
    echo "  chmod +x monaco"
    echo "  sudo mv monaco /usr/local/bin/"
    exit 1
fi

echo -e "${GREEN}✅ Monaco CLI found: $(monaco version)${NC}"

# Check environment variables
MISSING_VARS=0

if [ -z "$DT_ENVIRONMENT" ]; then
    echo -e "${RED}❌ DT_ENVIRONMENT not set${NC}"
    MISSING_VARS=1
fi

if [ -z "$DT_API_TOKEN" ]; then
    echo -e "${RED}❌ DT_API_TOKEN not set${NC}"
    MISSING_VARS=1
fi

if [ $MISSING_VARS -eq 1 ]; then
    echo ""
    echo -e "${YELLOW}Set required environment variables:${NC}"
    echo "  export DT_ENVIRONMENT='https://abc12345.live.dynatrace.com'"
    echo "  export DT_API_TOKEN='dt0c01.***'"
    echo "  export BIZOBS_API_URL='https://your-codespace.app.github.dev'"
    exit 1
fi

echo -e "${GREEN}✅ Environment: $DT_ENVIRONMENT${NC}"

# Validate BIZOBS_API_URL
if [ -z "$BIZOBS_API_URL" ]; then
    echo -e "${YELLOW}⚠️  BIZOBS_API_URL not set, using default: http://localhost:8080${NC}"
    export BIZOBS_API_URL="http://localhost:8080"
fi

echo -e "${GREEN}✅ BizObs API: $BIZOBS_API_URL${NC}"

# Check if monaco directory exists
if [ ! -d "$MONACO_DIR" ]; then
    echo -e "${RED}❌ Monaco directory not found: $MONACO_DIR${NC}"
    exit 1
fi

echo -e "${GREEN}✅ Monaco config found${NC}"
echo ""

# Parse command line arguments
DEPLOY_MODE="all"
DRY_RUN=""

while [[ $# -gt 0 ]]; do
    case $1 in
        --workflows)
            DEPLOY_MODE="workflows"
            shift
            ;;
        --bizevents)
            DEPLOY_MODE="bizevents"
            shift
            ;;
        --process-detection)
            DEPLOY_MODE="process-detection"
            shift
            ;;
        --dry-run)
            DRY_RUN="--dry-run"
            shift
            ;;
        --help)
            echo "Usage: $0 [OPTIONS]"
            echo ""
            echo "Options:"
            echo "  --workflows           Deploy only self-healing workflows"
            echo "  --bizevents          Deploy only BizEvents capture rules"
            echo "  --process-detection  Deploy only process detection rules"
            echo "  --dry-run            Simulate deployment without applying changes"
            echo "  --help               Show this help message"
            echo ""
            echo "Environment Variables:"
            echo "  DT_ENVIRONMENT       Dynatrace environment URL (required)"
            echo "  DT_API_TOKEN         Dynatrace API token (required)"
            echo "  BIZOBS_API_URL       BizObs API URL for workflows (optional)"
            echo "  DT_WORKFLOW_OWNER    Workflow owner (default: bizobs-automation)"
            echo ""
            exit 0
            ;;
        *)
            echo -e "${RED}Unknown option: $1${NC}"
            echo "Use --help for usage information"
            exit 1
            ;;
    esac
done

# Set workflow owner
if [ -z "$DT_WORKFLOW_OWNER" ]; then
    export DT_WORKFLOW_OWNER="bizobs-automation"
fi

# Deploy based on mode
cd "$MONACO_DIR"

if [ "$DRY_RUN" = "--dry-run" ]; then
    echo -e "${YELLOW}🧪 Running in DRY RUN mode (no changes will be applied)${NC}"
    echo ""
fi

case $DEPLOY_MODE in
    workflows)
        echo -e "${BLUE}📋 Deploying self-healing workflows...${NC}"
        monaco deploy $DRY_RUN -e bizobs-production manifest.yaml \
            --config workflow-disable-error-injection \
            --config workflow-auto-recovery \
            --config workflow-bulk-toggle
        ;;
    
    bizevents)
        echo -e "${BLUE}📋 Deploying BizEvents capture rules...${NC}"
        monaco deploy $DRY_RUN -e bizobs-production manifest.yaml \
            --config bizevents-nodejs
        ;;
    
    process-detection)
        echo -e "${BLUE}📋 Deploying process detection rules...${NC}"
        monaco deploy $DRY_RUN -e bizobs-production manifest.yaml \
            --config process-detection-bizobs
        ;;
    
    all)
        echo -e "${BLUE}📋 Deploying all automation configs...${NC}"
        monaco deploy $DRY_RUN -e bizobs-production manifest.yaml
        ;;
esac

if [ $? -eq 0 ]; then
    echo ""
    echo -e "${GREEN}================================================${NC}"
    echo -e "${GREEN}   ✅ Deployment Successful!${NC}"
    echo -e "${GREEN}================================================${NC}"
    echo ""
    
    if [ -z "$DRY_RUN" ]; then
        echo -e "${YELLOW}📊 What was deployed:${NC}"
        case $DEPLOY_MODE in
            workflows)
                echo "  • 3 Self-healing workflows"
                ;;
            bizevents)
                echo "  • BizEvents capture rule for Node.js"
                ;;
            process-detection)
                echo "  • Process group detection rule"
                ;;
            all)
                echo "  • 3 Self-healing workflows"
                echo "  • BizEvents capture rule"
                echo "  • Process group detection rule"
                ;;
        esac
        
        echo ""
        echo -e "${YELLOW}🔍 Verify in Dynatrace:${NC}"
        echo "  • Automation → Workflows → See 'BizObs Self-Healing' workflows"
        echo "  • Settings → Business Events → See capture rules"
        echo "  • Settings → Processes → See detection rules"
        echo ""
        echo -e "${YELLOW}🧪 Test self-healing:${NC}"
        echo "  1. Start BizObs with continuous journeys:"
        echo "     export ENABLE_CONTINUOUS_JOURNEYS=true && npm start"
        echo ""
        echo "  2. Wait for high error rate (Davis will detect)"
        echo ""
        echo "  3. Check workflow execution:"
        echo "     Dynatrace → Automation → Workflows → Executions"
        echo ""
        echo "  4. Verify CUSTOM_DEPLOYMENT events:"
        echo "     Dynatrace → Events → Filter by type"
        echo ""
    fi
else
    echo ""
    echo -e "${RED}================================================${NC}"
    echo -e "${RED}   ❌ Deployment Failed${NC}"
    echo -e "${RED}================================================${NC}"
    echo ""
    echo -e "${YELLOW}Troubleshooting:${NC}"
    echo "  • Check API token has required scopes:"
    echo "    - WriteConfig, ReadConfig, events.ingest,"
    echo "    - automation.workflows, settings.read, settings.write"
    echo "  • Verify DT_ENVIRONMENT is correct"
    echo "  • Check network connectivity to Dynatrace"
    echo ""
    exit 1
fi
