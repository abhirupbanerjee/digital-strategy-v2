#!/bin/bash

# =============================================================================
# DIGITAL STRATEGY BOT v2.0 - PHASE 1 TESTING SCRIPT
# =============================================================================
# Purpose: Test Phase 1 service layer implementation status
# Usage: ./test-phase1.sh
# =============================================================================

set -e

# Configuration
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$SCRIPT_DIR"  # Use current directory as project root
TIMESTAMP=$(date '+%Y%m%d_%H%M%S')
TEST_LOG="phase1_test_${TIMESTAMP}.log"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${BLUE}🚀 Digital Strategy Bot v2.0 - Phase 1 Testing${NC}" | tee "$TEST_LOG"
echo -e "${BLUE}=============================================${NC}" | tee -a "$TEST_LOG"
echo -e "Timestamp: ${YELLOW}$TIMESTAMP${NC}" | tee -a "$TEST_LOG"
echo -e "Project Root: ${YELLOW}$PROJECT_ROOT${NC}" | tee -a "$TEST_LOG"
echo "" | tee -a "$TEST_LOG"

cd "$PROJECT_ROOT"

# =============================================================================
# UTILITY FUNCTIONS
# =============================================================================

log_section() {
    echo -e "\n${BLUE}📊 $1${NC}" | tee -a "$TEST_LOG"
    echo "----------------------------------------" | tee -a "$TEST_LOG"
}

log_success() {
    echo -e "${GREEN}✅${NC} $1" | tee -a "$TEST_LOG"
}

log_warning() {
    echo -e "${YELLOW}⚠️${NC} $1" | tee -a "$TEST_LOG"
}

log_error() {
    echo -e "${RED}❌${NC} $1" | tee -a "$TEST_LOG"
}

log_info() {
    echo -e "ℹ️  $1" | tee -a "$TEST_LOG"
}

check_file() {
    local file_path="$1"
    local description="$2"
    
    if [ -f "$file_path" ]; then
        local lines=$(wc -l < "$file_path" 2>/dev/null || echo "0")
        log_success "$description ($lines lines)"
        return 0
    else
        log_error "$description - File not found: $file_path"
        return 1
    fi
}

check_directory() {
    local dir_path="$1"
    local description="$2"
    
    if [ -d "$dir_path" ]; then
        local file_count=$(find "$dir_path" -name "*.ts" -o -name "*.tsx" | wc -l)
        log_success "$description ($file_count TypeScript files)"
        return 0
    else
        log_error "$description - Directory not found: $dir_path"
        return 1
    fi
}

# =============================================================================
# PHASE 1 SERVICE LAYER TESTING
# =============================================================================

log_section "Phase 1 Service Layer Files"

# Core Services
check_file "services/aiProviderService.ts" "AIProviderService"
check_file "services/fileProcessingService.ts" "FileProcessingService" 
check_file "services/contentCleaningService.ts" "ContentCleaningService"
check_file "services/storageService.ts" "StorageService"

# Provider Abstraction
check_directory "lib/providers" "Provider Directory"
check_file "lib/providers/aiProvider.interface.ts" "AI Provider Interface"
check_file "lib/providers/openaiProvider.ts" "OpenAI Provider"
check_file "lib/providers/providerFactory.ts" "Provider Factory"

# Shared Components
check_directory "components/shared" "Shared Components Directory"
check_file "components/shared/MarkdownRenderer.tsx" "Markdown Renderer"

# Hooks
check_directory "hooks" "Hooks Directory"
check_file "hooks/useUIState.ts" "UI State Hook"

# =============================================================================
# CODE ANALYSIS
# =============================================================================

log_section "Code Analysis"

# Count service imports across the codebase
if command -v grep >/dev/null 2>&1; then
    ai_service_imports=$(grep -r "AIProviderService" app/ lib/ components/ 2>/dev/null | wc -l)
    file_service_imports=$(grep -r "FileProcessingService" app/ lib/ components/ 2>/dev/null | wc -l)
    content_service_imports=$(grep -r "ContentCleaningService" app/ lib/ components/ 2>/dev/null | wc -l)
    storage_service_imports=$(grep -r "StorageService" app/ lib/ components/ 2>/dev/null | wc -l)
    
    log_info "AIProviderService imports: $ai_service_imports"
    log_info "FileProcessingService imports: $file_service_imports"
    log_info "ContentCleaningService imports: $content_service_imports"
    log_info "StorageService imports: $storage_service_imports"
    
    total_service_imports=$((ai_service_imports + file_service_imports + content_service_imports + storage_service_imports))
    
    if [ $total_service_imports -gt 10 ]; then
        log_success "Service adoption looks good ($total_service_imports total imports)"
    elif [ $total_service_imports -gt 5 ]; then
        log_warning "Moderate service adoption ($total_service_imports total imports)"
    else
        log_warning "Low service adoption ($total_service_imports total imports) - Need more integration"
    fi
else
    log_warning "grep not available - skipping import analysis"
fi

# Check for LM Studio references (should be removed)
if command -v grep >/dev/null 2>&1; then
    lm_studio_refs=$(grep -r -i "lmstudio\|lm.studio\|LM_STUDIO" . --exclude-dir=node_modules --exclude-dir=.next --exclude="$TEST_LOG" 2>/dev/null | wc -l)
    
    if [ $lm_studio_refs -eq 0 ]; then
        log_success "LM Studio references removed (0 found)"
    else
        log_warning "LM Studio references still present ($lm_studio_refs found)"
        echo "  Found in:" | tee -a "$TEST_LOG"
        grep -r -i "lmstudio\|lm.studio\|LM_STUDIO" . --exclude-dir=node_modules --exclude-dir=.next --exclude="$TEST_LOG" 2>/dev/null | head -5 | tee -a "$TEST_LOG"
    fi
fi

# =============================================================================
# API ROUTE ANALYSIS
# =============================================================================

log_section "API Route Integration"

api_routes=("app/api/chat/route.ts" "app/api/upload/route.ts" "app/api/cleanup-threads/route.ts" "app/api/threads/route.ts")

for route in "${api_routes[@]}"; do
    if [ -f "$route" ]; then
        lines=$(wc -l < "$route")
        
        # Check if route uses new services
        uses_ai_service=$(grep -q "AIProviderService" "$route" && echo "yes" || echo "no")
        uses_file_service=$(grep -q "FileProcessingService" "$route" && echo "yes" || echo "no")
        uses_content_service=$(grep -q "ContentCleaningService" "$route" && echo "yes" || echo "no")
        uses_storage_service=$(grep -q "StorageService" "$route" && echo "yes" || echo "no")
        
        echo "  📁 $(basename "$route"): $lines lines" | tee -a "$TEST_LOG"
        echo "    - AIProviderService: $uses_ai_service" | tee -a "$TEST_LOG"
        echo "    - FileProcessingService: $uses_file_service" | tee -a "$TEST_LOG"
        echo "    - ContentCleaningService: $uses_content_service" | tee -a "$TEST_LOG"
        echo "    - StorageService: $uses_storage_service" | tee -a "$TEST_LOG"
        
        services_used=0
        [ "$uses_ai_service" = "yes" ] && ((services_used++))
        [ "$uses_file_service" = "yes" ] && ((services_used++))
        [ "$uses_content_service" = "yes" ] && ((services_used++))
        [ "$uses_storage_service" = "yes" ] && ((services_used++))
        
        if [ $services_used -ge 2 ]; then
            log_success "$(basename "$route") - Well integrated ($services_used/4 services)"
        elif [ $services_used -eq 1 ]; then
            log_warning "$(basename "$route") - Partially integrated ($services_used/4 services)"
        else
            log_error "$(basename "$route") - Not integrated (0/4 services)"
        fi
    else
        log_error "$(basename "$route") - File not found"
    fi
done

# =============================================================================
# ENVIRONMENT CONFIGURATION
# =============================================================================

log_section "Environment Configuration"

if [ -f ".env.local" ]; then
    log_success ".env.local file exists"
    
    # Check for required environment variables
    env_vars=("AI_PROVIDER" "ENABLE_FALLBACK")
    missing_vars=()
    
    for var in "${env_vars[@]}"; do
        if grep -q "^$var=" .env.local; then
            value=$(grep "^$var=" .env.local | cut -d'=' -f2)
            log_success "$var=$value"
        else
            log_warning "$var not set in .env.local"
            missing_vars+=("$var")
        fi
    done
    
    # Check for LM Studio vars (should be removed/disabled)
    lm_vars=("LM_STUDIO_ENABLED" "LM_STUDIO_URL" "LM_STUDIO_MODEL")
    for var in "${lm_vars[@]}"; do
        if grep -q "^$var=" .env.local; then
            value=$(grep "^$var=" .env.local | cut -d'=' -f2)
            if [[ "$value" == "false" || "$value" == "" ]]; then
                log_success "$var disabled ($value)"
            else
                log_warning "$var still enabled ($value) - should be disabled"
            fi
        fi
    done
    
    if [ ${#missing_vars[@]} -eq 0 ]; then
        log_success "All required environment variables configured"
    else
        log_warning "Missing environment variables: ${missing_vars[*]}"
    fi
else
    log_error ".env.local file not found"
fi

# =============================================================================
# DEPENDENCY CHECK
# =============================================================================

log_section "Dependencies"

if [ -f "package.json" ]; then
    log_success "package.json exists"
    
    # Check for TypeScript files
    if command -v find >/dev/null 2>&1; then
        ts_files=$(find . -name "*.ts" -o -name "*.tsx" | grep -v node_modules | wc -l)
        log_info "TypeScript files: $ts_files"
    fi
    
    # Check if node_modules exists
    if [ -d "node_modules" ]; then
        log_success "node_modules directory exists"
    else
        log_warning "node_modules directory not found - run 'npm install'"
    fi
else
    log_error "package.json not found"
fi

# =============================================================================
# BUILD TEST
# =============================================================================

log_section "Build Test"

if command -v npm >/dev/null 2>&1; then
    log_info "Testing TypeScript compilation..."
    
    if npm run build:check 2>/dev/null || npx tsc --noEmit 2>/dev/null; then
        log_success "TypeScript compilation successful"
    else
        log_warning "TypeScript compilation issues detected"
        log_info "Run 'npx tsc --noEmit' to see detailed errors"
    fi
else
    log_warning "npm not available - skipping build test"
fi

# =============================================================================
# SUMMARY REPORT
# =============================================================================

log_section "Phase 1 Implementation Summary"

echo "" | tee -a "$TEST_LOG"
echo "📋 IMPLEMENTATION STATUS:" | tee -a "$TEST_LOG"
echo "" | tee -a "$TEST_LOG"

# Count completed items
services_created=0
[ -f "services/aiProviderService.ts" ] && ((services_created++))
[ -f "services/fileProcessingService.ts" ] && ((services_created++))
[ -f "services/contentCleaningService.ts" ] && ((services_created++))
[ -f "services/storageService.ts" ] && ((services_created++))

providers_created=0
[ -f "lib/providers/aiProvider.interface.ts" ] && ((providers_created++))
[ -f "lib/providers/openaiProvider.ts" ] && ((providers_created++))
[ -f "lib/providers/providerFactory.ts" ] && ((providers_created++))

components_created=0
[ -f "components/shared/MarkdownRenderer.tsx" ] && ((components_created++))
[ -f "hooks/useUIState.ts" ] && ((components_created++))

echo "✅ Core Services: $services_created/4 created" | tee -a "$TEST_LOG"
echo "✅ Provider System: $providers_created/3 created" | tee -a "$TEST_LOG"
echo "✅ Shared Components: $components_created/2 created" | tee -a "$TEST_LOG"

# Calculate overall completion
total_items=9
completed_items=$((services_created + providers_created + components_created))
completion_percentage=$((completed_items * 100 / total_items))

echo "" | tee -a "$TEST_LOG"
echo "📊 OVERALL PROGRESS: $completed_items/$total_items items ($completion_percentage%)" | tee -a "$TEST_LOG"

if [ $completion_percentage -ge 90 ]; then
    echo -e "${GREEN}🎉 Phase 1 is nearly complete! Ready for final integration.${NC}" | tee -a "$TEST_LOG"
elif [ $completion_percentage -ge 70 ]; then
    echo -e "${YELLOW}⚡ Phase 1 is mostly complete. Some integration work needed.${NC}" | tee -a "$TEST_LOG"
else
    echo -e "${RED}🔧 Phase 1 needs significant work before moving to Phase 2.${NC}" | tee -a "$TEST_LOG"
fi

echo "" | tee -a "$TEST_LOG"
echo "📄 NEXT STEPS:" | tee -a "$TEST_LOG"

if [ $completion_percentage -lt 90 ]; then
    echo "1. Complete missing service files" | tee -a "$TEST_LOG"
    echo "2. Integrate services into API routes" | tee -a "$TEST_LOG"
    echo "3. Add required environment variables" | tee -a "$TEST_LOG"
fi

echo "4. Test all functionality locally" | tee -a "$TEST_LOG"
echo "5. Deploy Phase 1 optimizations" | tee -a "$TEST_LOG"
echo "6. Begin Phase 2 planning" | tee -a "$TEST_LOG"

echo "" | tee -a "$TEST_LOG"
echo -e "${BLUE}📋 Test log saved to: $TEST_LOG${NC}"
echo -e "${BLUE}📤 Share this log file for detailed review and next steps.${NC}"

# =============================================================================
# END OF SCRIPT
# =============================================================================
