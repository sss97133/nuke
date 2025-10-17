# Claude Code Development Safeguards & Protocols

## 🚨 CRITICAL: LLM Development Problems Identified

### Core Issues
1. **Context Limitations**: LLMs lose track of architectural decisions during heavy refactoring
2. **Documentation Amnesia**: Existing docs (DESIGN_SYSTEM.md, VEHICLE_PROFILE_COMPREHENSIVE_DOCUMENTATION.md) aren't referenced
3. **Mock Data Proliferation**: Fake counters, prices, scores keep appearing despite explicit instructions
4. **Incomplete Tool Debt**: Half-built features accumulate without completion tracking
5. **Design System Violations**: Modern UI patterns override established Windows 95/macOS 10 aesthetic

## 🛡️ MANDATORY SAFEGUARDS

### Before ANY Development Work
1. **ALWAYS Read These Docs First**:
   - `/nuke_frontend/DESIGN_SYSTEM.md` (Visual standards)
   - `/docs/guides/VEHICLE_PROFILE_COMPREHENSIVE_DOCUMENTATION.md` (Architecture)
   - This file (`CLAUDE_CODE_SAFEGUARDS.md`)

2. **Component Audit Checklist**:
   - Is this component complete or half-built?
   - Does it contain mock/fake data?
   - Does it follow the Windows 95 design system?
   - Does it have proper edit capabilities where needed?

3. **Architecture Verification**:
   - What is the INTENDED purpose vs current implementation?
   - Are we working on the right component for the task?
   - Does this change align with documented architecture?

## 🎯 VEHICLE PROFILE COMPONENT STATES

### ✅ COMPLETE & WORKING
- `VehicleHeader.tsx` - Basic vehicle identification
- `VehicleTimelineSection.tsx` - Timeline display
- `VehicleContributors.tsx` - Contributor listing

### ⚠️ INCOMPLETE TOOLS (HIGH PRIORITY)
- **Data Quality Score**: Shows score but no details/improvement path
- **Price Section**: Missing edit capabilities, no wizard integration
- **Vehicle Basic Info**: Display-only, needs edit mode with authorization
- **Image Gallery**: Lost smoothness after refactoring
- **Ownership Verification**: Shows "Pending" with no verification path

### 🚫 BROKEN/MOCK DATA (IMMEDIATE FIX NEEDED)
- Any counters showing fake numbers
- Price displays with placeholder data
- Confidence scores without real calculation
- Status indicators that don't reflect real data

## 📐 DESIGN SYSTEM COMPLIANCE

### MANDATORY VISUAL STANDARDS
- **Colors**: Light grey/white backgrounds, black text ONLY
- **Typography**: Arial 8pt, no modern fonts
- **Spacing**: Compact 8pt grid system
- **Aesthetic**: Windows 95/macOS 10 patterns ONLY
- **No AI Design**: Use documented component classes

### FORBIDDEN UI PATTERNS
- ❌ Modern gradients, shadows, or animations
- ❌ Tailwind-style rounded corners beyond border-radius: 4px
- ❌ Bright colors or modern color schemes
- ❌ Large modern spacing (use --space-1 through --space-8)

## 🔧 VEHICLE PROFILE EDIT CAPABILITIES

### REQUIRED EDIT MODES
- **Basic Vehicle Data**: Year, make, model, VIN, etc.
- **Description**: User-editable description with authorization
- **Price Data**: Integrated with wizard system
- **Categories/Tags**: Vehicle classification
- **Ownership Details**: Through verification wizard

### AUTHORIZATION LEVELS
- **Owner**: Full edit access
- **Moderator**: Data correction access
- **Consigner**: Limited business data access
- **Public**: View only

## 📚 COMPONENT DOCUMENTATION PROTOCOL

### Each Component Must Have
1. **Purpose Statement**: What is this component for?
2. **Completion Status**: Complete, Partial, Mock, or Broken
3. **Dependencies**: What other components/services does it use?
4. **Edit Capabilities**: What can users modify?
5. **Authorization**: Who can edit what?

## 🔍 DEBUGGING INCOMPLETE TOOLS

### Data Quality Score Investigation
```bash
# Find the component
find . -name "*DataQuality*" -o -name "*Quality*" -o -name "*Score*"

# Check calculation logic
grep -r "quality.*score" src/
grep -r "confidence" src/
```

### Price Section Analysis
```bash
# Find price components
find . -name "*Price*" -o -name "*pricing*"

# Check for edit capabilities
grep -r "edit.*price" src/
grep -r "wizard" src/
```

## 🚨 REFACTORING SAFETY PROTOCOL

### Before Large Changes
1. **Document Current State**: What works now?
2. **Identify Dependencies**: What components depend on this?
3. **Test Critical Paths**: Image upload, display, navigation
4. **Create Rollback Plan**: How to restore if broken?

### During Refactoring
1. **Maintain Core Functionality**: Don't break existing features
2. **Test Each Step**: Verify functionality after each change
3. **Reference Documentation**: Check against architectural goals

### After Refactoring
1. **Functional Testing**: Does everything still work?
2. **Design Compliance**: Does it match the design system?
3. **Documentation Update**: Update docs if architecture changed

## 📋 DEVELOPMENT CHECKLIST

### For Every Component Change
- [ ] Read relevant documentation first
- [ ] Verify component completion status
- [ ] Check for mock/fake data
- [ ] Ensure design system compliance
- [ ] Test edit capabilities if applicable
- [ ] Verify authorization levels work
- [ ] Update documentation if needed

### For Vehicle Profile Work
- [ ] Check VEHICLE_PROFILE_COMPREHENSIVE_DOCUMENTATION.md
- [ ] Verify component is in correct column/section
- [ ] Ensure proper integration with parent components
- [ ] Test data flow from database to UI
- [ ] Verify edit modes work with proper authorization

## 💾 MEMORY MANAGEMENT

### Context Preservation
- Always start development sessions by reading this file
- Reference component documentation before making changes
- Keep architectural decisions documented
- Update this file when new patterns are established

### Cross-Tool Consistency
- This file should be referenced in Claude Code AND Windsurf
- Design decisions should be consistent between tools
- Both tools should reference the same documentation

---

**Last Updated**: $(date)
**Status**: Active Safeguards Protocol
**Next Review**: After any major refactoring or when problems recur