#!/bin/bash

# =============================================================================
# DIGITAL STRATEGY BOT v2.0 - PHASE 1 IMPLEMENTATION AUDIT
# =============================================================================
# Purpose: Verify all Phase 1 components are properly implemented
# Usage: ./scripts/phase1-audit.sh
# Output: Detailed report of implemented vs missing components
# =============================================================================

set -e

# Configuration
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
TIMESTAMP=$(date '+%Y%m%d_%H%M%S')
REPORT_FILE="$PROJECT_ROOT/phase1-audit-report_$TIMESTAMP.md"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# Counters
TOTAL_CHECKS=0
PASSED_CHECKS=0
FAILED_CHECKS=0
WARNING_CHECKS=0

# Arrays to store results
declare -a MISSING_FILES=()
declare -a INCOMPLETE_IMPLEMENTATIONS=()
declare -a MISSING_INTEGRATIONS=()
declare -a ENV_VARS_MISSING=()

# =============================================================================
# UTILITY FUNCTIONS
# =============================================================================

log_header() {
    echo -e "\n${BLUE}═══════════════════════════════════════════════════════${NC}"
    echo -e "${BLUE}  $1${NC}"
    echo -e "${BLUE}═══════════════════════════════════════════════════════${NC}"
}

log_section() {
    echo -e "\n${CYAN}▶ $1${NC}"
    echo -e "${CYAN}────────────────────────────────────────${NC}"
}

log_check() {
    ((TOTAL_CHECKS++))
    echo -n "  Checking: $1 ... "
}

log_pass() {
    ((PASSED_CHECKS++))
    echo -e "${GREEN}✓ PASS${NC}"
    echo "✅ $1" >> "$REPORT_FILE"
}

log_fail() {
    ((FAILED_CHECKS++))
    echo -e "${RED}✗ FAIL${NC}"
    echo "❌ $1" >> "$REPORT_FILE"
    MISSING_FILES+=("$1")
}

log_warning() {
    ((WARNING_CHECKS++))
    echo -e "${YELLOW}⚠ WARNING${NC}"
    echo "⚠️ $1" >> "$REPORT_FILE"
}

log_info() {
    echo -e "${CYAN}ℹ $1${NC}"
    echo "ℹ️ $1" >> "$REPORT_FILE"
}

check_file_exists() {
    local file="$1"
    local description="$2"
    
    log_check "$description"
    if [ -f "$PROJECT_ROOT/$file" ]; then
        log_pass "$description exists"
        return 0
    else
        log_fail "$description missing: $file"
        return 1
    fi
}

check_directory_exists() {
    local dir="$1"
    local description="$2"
    
    log_check "$description"
    if [ -d "$PROJECT_ROOT/$dir" ]; then
        log_pass "$description exists"
        return 0
    else
        log_fail "$description missing: $dir"
        return 1
    fi
}

check_implementation() {
    local file="$1"
    local pattern="$2"
    local description="$3"
    
    log_check "$description"
    if [ -f "$PROJECT_ROOT/$file" ]; then
        if grep -q "$pattern" "$PROJECT_ROOT/$file" 2>/dev/null; then
            log_pass "$description implemented"
            return 0
        else
            log_warning "$description - file exists but implementation incomplete"
            INCOMPLETE_IMPLEMENTATIONS+=("$description")
            return 1
        fi
    else
        log_fail "$description - file not found"
        return 1
    fi
}

check_import() {
    local file="$1"
    local import="$2"
    local description="$3"
    
    log_check "$description"
    if [ -f "$PROJECT_ROOT/$file" ]; then
        if grep -q "import.*$import" "$PROJECT_ROOT/$file" 2>/dev/null; then
            log_pass "$description uses new service"
            return 0
        else
            log_warning "$description not using new service yet"
            MISSING_INTEGRATIONS+=("$file needs to import $import")
            return 1
        fi
    else
        echo -e "${YELLOW}SKIP${NC} - File not found"
        return 2
    fi
}

# =============================================================================
# PHASE 1 AUDIT CHECKS
# =============================================================================

# Initialize report
cat > "$REPORT_FILE" << EOF
# Phase 1 Implementation Audit Report
**Date:** $(date)
**Project:** Digital Strategy Bot v2.0

## Summary
EOF

# Start audit
clear
echo -e "${BLUE}╔═══════════════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║     DIGITAL STRATEGY BOT v2.0 - PHASE 1 AUDIT        ║${NC}"
echo -e "${BLUE}╚═══════════════════════════════════════════════════════╝${NC}"

# =============================================================================
log_header "1. SERVICE LAYER AUDIT"
# =============================================================================

log_section "Core Services (Week 1 Deliverables)"

# Check service files
check_file_exists "services/fileProcessingService.ts" "FileProcessingService"
check_file_exists "services/contentCleaningService.ts" "ContentCleaningService"
check_file_exists "services/storageService.ts" "StorageService"
check_file_exists "services/aiProviderService.ts" "AIProviderService"

# Check service implementations
log_section "Service Implementation Quality"

check_implementation "services/fileProcessingService.ts" "class FileProcessingService\|export.*FileProcessingService" "FileProcessingService class"
check_implementation "services/fileProcessingService.ts" "validateFile\|processFile" "File validation methods"
check_implementation "services/fileProcessingService.ts" "determineToolType" "Tool type determination"

check_implementation "services/contentCleaningService.ts" "cleanContent" "Content cleaning method"
check_implementation "services/contentCleaningService.ts" "preserveFileLinks" "File link preservation"
check_implementation "services/contentCleaningService.ts" "removeInstructions" "Instruction removal"

check_implementation "services/storageService.ts" "uploadToBlob" "Blob upload method"
check_implementation "services/storageService.ts" "deleteFromBlob" "Blob deletion method"
check_implementation "services/storageService.ts" "checkStorageThreshold" "Storage threshold check"
check_implementation "services/storageService.ts" "cleanupOldFiles" "Automatic cleanup"

check_implementation "services/aiProviderService.ts" "getProvider" "Provider selection"
check_implementation "services/aiProviderService.ts" "generateResponse" "Response generation"
check_implementation "services/aiProviderService.ts" "handleFallback" "Fallback mechanism"

# =============================================================================
log_header "2. AI PROVIDER ABSTRACTION AUDIT"
# =============================================================================

log_section "Provider System (Week 2 Deliverables)"

# Check provider files
check_file_exists "lib/providers/aiProvider.interface.ts" "AI Provider Interface"
check_file_exists "lib/providers/openaiProvider.ts" "OpenAI Provider"
check_file_exists "lib/providers/lmStudioProvider.ts" "LM Studio Provider"
check_file_exists "lib/providers/providerFactory.ts" "Provider Factory"

# Check provider implementations
log_section "Provider Implementation Quality"

check_implementation "lib/providers/aiProvider.interface.ts" "interface AIProvider" "AIProvider interface"
check_implementation "lib/providers/aiProvider.interface.ts" "generateResponse" "Response method signature"
check_implementation "lib/providers/aiProvider.interface.ts" "processFile" "File processing signature"

check_implementation "lib/providers/openaiProvider.ts" "implements AIProvider" "OpenAI implements interface"
check_implementation "lib/providers/openaiProvider.ts" "isAvailable" "Availability check"
check_implementation "lib/providers/openaiProvider.ts" "generateResponse" "OpenAI response generation"

check_implementation "lib/providers/lmStudioProvider.ts" "implements AIProvider" "LMStudio implements interface"
check_implementation "lib/providers/lmStudioProvider.ts" "Phase 3" "Phase 3 placeholder"

check_implementation "lib/providers/providerFactory.ts" "createProvider" "Provider creation"
check_implementation "lib/providers/providerFactory.ts" "getAvailableProviders" "Provider listing"

# =============================================================================
log_header "3. SHARED COMPONENTS AUDIT"
# =============================================================================

log_section "Reusable Components"

# Check shared components
check_file_exists "components/shared/MarkdownRenderer.tsx" "MarkdownRenderer Component"
check_file_exists "hooks/useUIState.ts" "useUIState Hook"

# Check component implementations
check_implementation "components/shared/MarkdownRenderer.tsx" "export.*MarkdownRenderer" "MarkdownRenderer export"
check_implementation "components/shared/MarkdownRenderer.tsx" "ReactMarkdown" "Markdown rendering"
check_implementation "components/shared/MarkdownRenderer.tsx" "mobile.*responsive" "Mobile responsive styles"

check_implementation "hooks/useUIState.ts" "export.*useUIState" "useUIState export"
check_implementation "hooks/useUIState.ts" "isMobile\|isTablet\|isDesktop" "Device detection"
check_implementation "hooks/useUIState.ts" "loading\|error" "State management"

# =============================================================================
log_header "4. API ROUTE INTEGRATION AUDIT"
# =============================================================================

log_section "Service Integration in API Routes"

# Check if API routes are using new services
check_import "app/api/chat/route.ts" "aiProviderService\|AIProviderService" "Chat route"
check_import "app/api/upload/route.ts" "fileProcessingService\|FileProcessingService" "Upload route"
check_import "app/api/cleanup-threads/route.ts" "storageService\|StorageService" "Cleanup route"
check_import "app/api/files/[id]/route.ts" "storageService\|StorageService" "File route"

# Check for old code that should be removed
log_section "Code Cleanup Verification"

log_check "Checking for duplicate file processing code"
if grep -r "validateFileSize.*MAX_FILE_SIZE" "$PROJECT_ROOT/app/api" --include="*.ts" | grep -v "fileProcessingService" | grep -c "" > /dev/null 2>&1; then
    DUPLICATE_COUNT=$(grep -r "validateFileSize\|MAX_FILE_SIZE" "$PROJECT_ROOT/app/api" --include="*.ts" | grep -v "fileProcessingService" | wc -l)
    if [ "$DUPLICATE_COUNT" -gt 0 ]; then
        log_warning "Found $DUPLICATE_COUNT instances of duplicate file validation"
        INCOMPLETE_IMPLEMENTATIONS+=("Remove duplicate file validation code")
    else
        log_pass "No duplicate file processing found"
    fi
else
    log_pass "File processing consolidated"
fi

# =============================================================================
log_header "5. ENVIRONMENT CONFIGURATION AUDIT"
# =============================================================================

log_section "Environment Variables"

# Check .env.example for new variables
if [ -f "$PROJECT_ROOT/.env.example" ] || [ -f "$PROJECT_ROOT/.env.local" ] || [ -f "$PROJECT_ROOT/.env" ]; then
    ENV_FILE=$(ls "$PROJECT_ROOT/.env.example" "$PROJECT_ROOT/.env.local" "$PROJECT_ROOT/.env" 2>/dev/null | head -1)
    
    log_check "AI_PROVIDER configuration"
    if grep -q "AI_PROVIDER" "$ENV_FILE" 2>/dev/null; then
        log_pass "AI_PROVIDER configured"
    else
        log_warning "AI_PROVIDER not configured"
        ENV_VARS_MISSING+=("AI_PROVIDER=openai")
    fi
    
    log_check "ENABLE_FALLBACK configuration"
    if grep -q "ENABLE_FALLBACK" "$ENV_FILE" 2>/dev/null; then
        log_pass "ENABLE_FALLBACK configured"
    else
        log_warning "ENABLE_FALLBACK not configured"
        ENV_VARS_MISSING+=("ENABLE_FALLBACK=true")
    fi
    
    log_check "LM_STUDIO_ENABLED configuration"
    if grep -q "LM_STUDIO_ENABLED" "$ENV_FILE" 2>/dev/null; then
        log_pass "LM_STUDIO_ENABLED configured"
    else
        log_warning "LM_STUDIO_ENABLED not configured"
        ENV_VARS_MISSING+=("LM_STUDIO_ENABLED=false")
    fi
    
    log_check "Feature flags"
    if grep -q "FEATURE_CODE_OPTIMIZATION" "$ENV_FILE" 2>/dev/null; then
        log_pass "Feature flags configured"
    else
        log_warning "Feature flags not configured"
        ENV_VARS_MISSING+=("FEATURE_CODE_OPTIMIZATION=true")
    fi
else
    log_warning "No environment file found"
fi

# =============================================================================
log_header "6. TYPE SAFETY AUDIT"
# =============================================================================

log_section "TypeScript Types and Interfaces"

# Check for TypeScript types
check_file_exists "types/services.d.ts" "Service type definitions"
check_file_exists "types/providers.d.ts" "Provider type definitions"

# If types are inline, check in service files
if [ ! -f "$PROJECT_ROOT/types/services.d.ts" ]; then
    log_check "Inline type definitions"
    if grep -q "interface.*Service\|type.*Service" "$PROJECT_ROOT/services/"*.ts 2>/dev/null; then
        log_pass "Types defined inline in services"
    else
        log_warning "Service types may need definition"
    fi
fi

# =============================================================================
log_header "7. TESTING & DOCUMENTATION AUDIT"
# =============================================================================

log_section "Testing Infrastructure"

# Check for test files
check_file_exists "services/__tests__/fileProcessingService.test.ts" "FileProcessingService tests"
check_file_exists "services/__tests__/contentCleaningService.test.ts" "ContentCleaningService tests"
check_file_exists "services/__tests__/storageService.test.ts" "StorageService tests"
check_file_exists "services/__tests__/aiProviderService.test.ts" "AIProviderService tests"

# If no test files, check for any test setup
if [ "$FAILED_CHECKS" -gt 3 ]; then
    log_info "Test files not created yet - Phase 1 testing pending"
fi

log_section "Documentation"

check_file_exists "docs/phase1-implementation.md" "Phase 1 documentation"
check_file_exists "docs/service-architecture.md" "Service architecture docs"
check_file_exists "CHANGELOG.md" "Changelog"

# =============================================================================
log_header "8. MIGRATION READINESS AUDIT"
# =============================================================================

log_section "Production Safety Checks"

log_check "Feature flag implementation"
if grep -r "FEATURE_CODE_OPTIMIZATION\|process.env.FEATURE" "$PROJECT_ROOT/app" --include="*.ts" --include="*.tsx" | grep -c "" > /dev/null 2>&1; then
    log_pass "Feature flags implemented"
else
    log_warning "Feature flags not fully implemented"
    MISSING_INTEGRATIONS+=("Implement feature flags for safe deployment")
fi

log_check "Backward compatibility"
if grep -r "deprecated\|@deprecated\|backwards.*compat" "$PROJECT_ROOT/services" --include="*.ts" | grep -c "" > /dev/null 2>&1; then
    log_pass "Backward compatibility considered"
else
    log_info "Ensure backward compatibility in services"
fi

# =============================================================================
# GENERATE SUMMARY REPORT
# =============================================================================

log_header "AUDIT SUMMARY"

# Calculate completion percentage
COMPLETION_PERCENTAGE=$((PASSED_CHECKS * 100 / TOTAL_CHECKS))

echo ""
echo -e "${CYAN}═══════════════════════════════════════${NC}"
echo -e "${CYAN}  PHASE 1 IMPLEMENTATION STATUS${NC}"
echo -e "${CYAN}═══════════════════════════════════════${NC}"
echo ""
echo -e "Total Checks:     ${YELLOW}$TOTAL_CHECKS${NC}"
echo -e "Passed:          ${GREEN}$PASSED_CHECKS${NC}"
echo -e "Failed:          ${RED}$FAILED_CHECKS${NC}"
echo -e "Warnings:        ${YELLOW}$WARNING_CHECKS${NC}"
echo -e "Completion:      ${YELLOW}$COMPLETION_PERCENTAGE%${NC}"
echo ""

# Append summary to report
cat >> "$REPORT_FILE" << EOF

## Results
- **Total Checks:** $TOTAL_CHECKS
- **Passed:** $PASSED_CHECKS ✅
- **Failed:** $FAILED_CHECKS ❌
- **Warnings:** $WARNING_CHECKS ⚠️
- **Completion:** $COMPLETION_PERCENTAGE%

EOF

# List missing items
if [ ${#MISSING_FILES[@]} -gt 0 ]; then
    echo -e "${RED}Missing Files/Components:${NC}"
    echo "## Missing Files/Components" >> "$REPORT_FILE"
    for item in "${MISSING_FILES[@]}"; do
        echo -e "  ${RED}✗${NC} $item"
        echo "- $item" >> "$REPORT_FILE"
    done
    echo ""
fi

if [ ${#INCOMPLETE_IMPLEMENTATIONS[@]} -gt 0 ]; then
    echo -e "${YELLOW}Incomplete Implementations:${NC}"
    echo "## Incomplete Implementations" >> "$REPORT_FILE"
    for item in "${INCOMPLETE_IMPLEMENTATIONS[@]}"; do
        echo -e "  ${YELLOW}⚠${NC} $item"
        echo "- $item" >> "$REPORT_FILE"
    done
    echo ""
fi

if [ ${#MISSING_INTEGRATIONS[@]} -gt 0 ]; then
    echo -e "${YELLOW}Missing Integrations:${NC}"
    echo "## Missing Integrations" >> "$REPORT_FILE"
    for item in "${MISSING_INTEGRATIONS[@]}"; do
        echo -e "  ${YELLOW}⚠${NC} $item"
        echo "- $item" >> "$REPORT_FILE"
    done
    echo ""
fi

if [ ${#ENV_VARS_MISSING[@]} -gt 0 ]; then
    echo -e "${YELLOW}Missing Environment Variables:${NC}"
    echo "## Missing Environment Variables" >> "$REPORT_FILE"
    echo '```env' >> "$REPORT_FILE"
    for item in "${ENV_VARS_MISSING[@]}"; do
        echo -e "  ${YELLOW}+${NC} $item"
        echo "$item" >> "$REPORT_FILE"
    done
    echo '```' >> "$REPORT_FILE"
    echo ""
fi

# =============================================================================
# ACTION ITEMS
# =============================================================================

cat >> "$REPORT_FILE" << EOF

## Action Items for Phase 1 Completion

### Critical (Must Complete)
EOF

if [ ${#MISSING_FILES[@]} -gt 0 ]; then
    echo "1. Create missing service files" >> "$REPORT_FILE"
fi

if [ ${#MISSING_INTEGRATIONS[@]} -gt 0 ]; then
    echo "2. Integrate services into API routes" >> "$REPORT_FILE"
fi

if [ ${#ENV_VARS_MISSING[@]} -gt 0 ]; then
    echo "3. Add missing environment variables" >> "$REPORT_FILE"
fi

cat >> "$REPORT_FILE" << EOF

### Important (Should Complete)
1. Add comprehensive tests for all services
2. Document service architecture and usage
3. Implement feature flags for safe deployment
4. Remove duplicate code from API routes
5. Ensure backward compatibility

### Nice to Have
1. Add performance monitoring
2. Create migration guide
3. Set up automated testing
4. Add service health checks

## Next Steps
1. Address all critical missing components
2. Test service integration locally
3. Update API routes to use new services
4. Configure environment variables
5. Run comprehensive testing
6. Deploy with feature flags disabled
7. Gradually enable features in production

---
*Generated: $(date)*
EOF

# Final message
echo -e "${CYAN}═══════════════════════════════════════${NC}"
echo -e "${GREEN}✅ Audit Complete!${NC}"
echo -e "Report saved to: ${YELLOW}$REPORT_FILE${NC}"
echo ""

# Provide completion status
if [ "$COMPLETION_PERCENTAGE" -ge 90 ]; then
    echo -e "${GREEN}🎉 Phase 1 is nearly complete! Just a few items to finish.${NC}"
elif [ "$COMPLETION_PERCENTAGE" -ge 70 ]; then
    echo -e "${YELLOW}📈 Good progress! Focus on integration and testing.${NC}"
elif [ "$COMPLETION_PERCENTAGE" -ge 50 ]; then
    echo -e "${YELLOW}⚡ Halfway there! Core services need completion.${NC}"
else
    echo -e "${RED}🔧 Significant work remaining. Review the report for priorities.${NC}"
fi

echo ""
echo "Run 'cat $REPORT_FILE' to view the full report."

# Exit with appropriate code
if [ "$FAILED_CHECKS" -eq 0 ] && [ "$WARNING_CHECKS" -eq 0 ]; then
    exit 0
elif [ "$FAILED_CHECKS" -eq 0 ]; then
    exit 0  # Warnings don't fail the script
else
    exit 1
fi
