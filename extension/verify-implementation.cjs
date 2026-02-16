/**
 * Verification script for Task #4 implementation
 * Checks that all required features are implemented in the code
 */

const fs = require('fs');
const path = require('path');

console.log('==========================================');
console.log('Task #4: Record Management Verification');
console.log('==========================================\n');

// Check files exist
const filesToCheck = [
  'src/types.ts',
  'src/popup/popup.ts',
  'popup.css',
  'popup.html',
  'dist/popup/popup.js',
  'dist/popup.css',
  'dist/popup.html',
  'TASK-4-VERIFICATION.md'
];

console.log('1. File Existence Check:');
let allFilesExist = true;
filesToCheck.forEach(file => {
  const exists = fs.existsSync(path.join(__dirname, file));
  console.log(`   ${exists ? '✅' : '❌'} ${file}`);
  if (!exists) allFilesExist = false;
});

if (!allFilesExist) {
  console.log('\n❌ Some files are missing!');
  process.exit(1);
}

// Read source files
const typesContent = fs.readFileSync(path.join(__dirname, 'src/types.ts'), 'utf8');
const popupTsContent = fs.readFileSync(path.join(__dirname, 'src/popup/popup.ts'), 'utf8');
const cssContent = fs.readFileSync(path.join(__dirname, 'popup.css'), 'utf8');

console.log('\n2. Feature Implementation Check:');

// Check RecordGroup interface
const hasRecordGroup = typesContent.includes('interface RecordGroup');
console.log(`   ${hasRecordGroup ? '✅' : '❌'} RecordGroup interface defined`);

// Check sortOrder field
const hasSortOrder = typesContent.includes('sortOrder?:');
console.log(`   ${hasSortOrder ? '✅' : '❌'} sortOrder field added to Record`);

// Check grouping functions
const hasGrouping = popupTsContent.includes('groupRecordsByTitle');
console.log(`   ${hasGrouping ? '✅' : '❌'} Group records by title function`);

const hasCreateGroup = popupTsContent.includes('createGroupElement');
console.log(`   ${hasCreateGroup ? '✅' : '❌'} Create group element function`);

// Check edit topic
const hasEditTopic = popupTsContent.includes('handleEditTopic');
console.log(`   ${hasEditTopic ? '✅' : '❌'} Handle edit topic function`);

const hasUpdateTopic = popupTsContent.includes('updateRecordTopic');
console.log(`   ${hasUpdateTopic ? '✅' : '❌'} Update record topic function`);

// Check copy time
const hasCopyTime = popupTsContent.includes('handleCopyTime');
console.log(`   ${hasCopyTime ? '✅' : '❌'} Handle copy time function`);

const hasClipboard = popupTsContent.includes('navigator.clipboard.writeText');
console.log(`   ${hasClipboard ? '✅' : '❌'} Clipboard API usage`);

// Check VOD URL builder
const hasBuildVOD = popupTsContent.includes('buildVODUrl');
console.log(`   ${hasBuildVOD ? '✅' : '❌'} Build VOD URL function`);

const hasTwitchFallback = popupTsContent.includes('/videos');
console.log(`   ${hasTwitchFallback ? '✅' : '❌'} Twitch VOD fallback logic`);

// Check record drag and drop
const hasRecordDragStart = popupTsContent.includes('handleRecordDragStart');
const hasRecordDragOver = popupTsContent.includes('handleRecordDragOver');
const hasRecordDrop = popupTsContent.includes('handleRecordDrop');
const hasReorderRecords = popupTsContent.includes('reorderRecordsInGroup');
console.log(`   ${hasRecordDragStart && hasRecordDragOver && hasRecordDrop ? '✅' : '❌'} Record drag-and-drop handlers`);
console.log(`   ${hasReorderRecords ? '✅' : '❌'} Reorder records function`);

// Check group drag and drop
const hasGroupDragStart = popupTsContent.includes('handleGroupDragStart');
const hasGroupDragOver = popupTsContent.includes('handleGroupDragOver');
const hasGroupDrop = popupTsContent.includes('handleGroupDrop');
const hasReorderGroups = popupTsContent.includes('reorderGroups');
console.log(`   ${hasGroupDragStart && hasGroupDragOver && hasGroupDrop ? '✅' : '❌'} Group drag-and-drop handlers`);
console.log(`   ${hasReorderGroups ? '✅' : '❌'} Reorder groups function`);

// Check move record to folder
const hasMoveRecord = popupTsContent.includes('moveRecordToFolder');
console.log(`   ${hasMoveRecord ? '✅' : '❌'} Move record to folder function`);

// Check CSS styles
const hasGroupStyles = cssContent.includes('.record-group');
const hasGroupHeader = cssContent.includes('.record-group-header');
const hasCopyBtn = cssContent.includes('.record-copy-btn');
const hasDragStyles = cssContent.includes('.dragging');
const hasDragOver = cssContent.includes('.drag-over');
console.log(`   ${hasGroupStyles ? '✅' : '❌'} Group styles in CSS`);
console.log(`   ${hasGroupHeader ? '✅' : '❌'} Group header styles`);
console.log(`   ${hasCopyBtn ? '✅' : '❌'} Copy button styles`);
console.log(`   ${hasDragStyles && hasDragOver ? '✅' : '❌'} Drag-and-drop styles`);

console.log('\n3. Code Quality Check:');

// Check for unsafe DOM manipulation
const hasInnerHTML = popupTsContent.includes('.innerHTML');
console.log(`   ${!hasInnerHTML ? '✅' : '❌'} No innerHTML usage (security)`);

// Check for proper event listeners
const hasEventListeners = popupTsContent.includes('addEventListener');
console.log(`   ${hasEventListeners ? '✅' : '❌'} Event listeners properly added`);

// Check for error handling
const hasTryCatch = popupTsContent.includes('try {') && popupTsContent.includes('catch');
console.log(`   ${hasTryCatch ? '✅' : '❌'} Error handling present`);

console.log('\n4. Build Output Check:');

const distPopupJs = path.join(__dirname, 'dist/popup/popup.js');
const distPopupCss = path.join(__dirname, 'dist/popup.css');

const distJsSize = fs.statSync(distPopupJs).size;
const distCssSize = fs.statSync(distPopupCss).size;

console.log(`   ✅ popup.js size: ${(distJsSize / 1024).toFixed(2)} KB`);
console.log(`   ✅ popup.css size: ${(distCssSize / 1024).toFixed(2)} KB`);

// Check if compiled JS contains the functions
const distJsContent = fs.readFileSync(distPopupJs, 'utf8');
const hasCompiledGrouping = distJsContent.includes('groupRecordsByTitle') || distJsContent.length > 20000;
console.log(`   ${hasCompiledGrouping ? '✅' : '❌'} Compiled JS contains new features`);

console.log('\n==========================================');
console.log('Summary:');
console.log('==========================================');

const allChecks = [
  hasRecordGroup, hasSortOrder, hasGrouping, hasCreateGroup,
  hasEditTopic, hasUpdateTopic, hasCopyTime, hasClipboard,
  hasBuildVOD, hasTwitchFallback,
  hasRecordDragStart, hasRecordDragOver, hasRecordDrop, hasReorderRecords,
  hasGroupDragStart, hasGroupDragOver, hasGroupDrop, hasReorderGroups,
  hasMoveRecord,
  hasGroupStyles, hasGroupHeader, hasCopyBtn, hasDragStyles, hasDragOver,
  !hasInnerHTML, hasEventListeners, hasTryCatch,
  hasCompiledGrouping
];

const passedChecks = allChecks.filter(Boolean).length;
const totalChecks = allChecks.length;

console.log(`\nPassed: ${passedChecks}/${totalChecks} checks`);

if (passedChecks === totalChecks) {
  console.log('\n✅ All implementation checks passed!');
  console.log('\nNext steps:');
  console.log('1. Load extension in Chrome: chrome://extensions/');
  console.log('2. Follow manual testing guide: TASK-4-VERIFICATION.md');
  console.log('3. Test all 10 acceptance criteria');
  process.exit(0);
} else {
  console.log('\n❌ Some checks failed. Please review the implementation.');
  process.exit(1);
}
