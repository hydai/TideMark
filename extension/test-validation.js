/**
 * Test script to verify import/export validation logic
 * Run with: node test-validation.js
 */

// Test data
const validData = {
  version: "1.0",
  exportedAt: "2026-02-16T00:00:00.000Z",
  records: [
    {
      id: "record-1",
      timestamp: "2026-02-16T00:00:00.000Z",
      liveTime: "01:23:45",
      title: "Test Title",
      topic: "Test Topic",
      folderId: null,
      channelUrl: "https://youtu.be/test",
      platform: "youtube"
    }
  ],
  folders: [
    {
      id: "folder-1",
      name: "Test Folder",
      created: "2026-02-16T00:00:00.000Z"
    }
  ]
};

const invalidCases = [
  {
    name: "Missing version",
    data: {
      exportedAt: "2026-02-16T00:00:00.000Z",
      records: [],
      folders: []
    }
  },
  {
    name: "Missing exportedAt",
    data: {
      version: "1.0",
      records: [],
      folders: []
    }
  },
  {
    name: "Records not array",
    data: {
      version: "1.0",
      exportedAt: "2026-02-16T00:00:00.000Z",
      records: "not array",
      folders: []
    }
  },
  {
    name: "Folders not array",
    data: {
      version: "1.0",
      exportedAt: "2026-02-16T00:00:00.000Z",
      records: [],
      folders: "not array"
    }
  },
  {
    name: "Record missing required fields",
    data: {
      version: "1.0",
      exportedAt: "2026-02-16T00:00:00.000Z",
      records: [
        {
          id: "test",
          title: "test"
          // missing other required fields
        }
      ],
      folders: []
    }
  },
  {
    name: "Folder missing required fields",
    data: {
      version: "1.0",
      exportedAt: "2026-02-16T00:00:00.000Z",
      records: [],
      folders: [
        {
          id: "test"
          // missing name and created
        }
      ]
    }
  },
  {
    name: "Null data",
    data: null
  },
  {
    name: "Non-object data",
    data: "string"
  }
];

// Validation function (copy from popup.ts logic)
function validateImportData(data) {
  // Check required fields
  if (!data || typeof data !== 'object') {
    return false;
  }

  if (!data.version || typeof data.version !== 'string') {
    return false;
  }

  if (!data.exportedAt || typeof data.exportedAt !== 'string') {
    return false;
  }

  if (!Array.isArray(data.records)) {
    return false;
  }

  if (!Array.isArray(data.folders)) {
    return false;
  }

  // Validate each record has required fields
  for (const record of data.records) {
    if (!record.id || !record.timestamp || !record.liveTime ||
        !record.title || !record.topic || !record.channelUrl || !record.platform) {
      return false;
    }
  }

  // Validate each folder has required fields
  for (const folder of data.folders) {
    if (!folder.id || !folder.name || !folder.created) {
      return false;
    }
  }

  return true;
}

// Run tests
console.log('====================================');
console.log('Import/Export Validation Tests');
console.log('====================================\n');

let passed = 0;
let failed = 0;

// Test valid data
console.log('Test: Valid data');
const validResult = validateImportData(validData);
if (validResult === true) {
  console.log('✅ PASS\n');
  passed++;
} else {
  console.log('❌ FAIL - Expected true, got', validResult, '\n');
  failed++;
}

// Test invalid cases
invalidCases.forEach((testCase) => {
  console.log(`Test: ${testCase.name}`);
  const result = validateImportData(testCase.data);
  if (result === false) {
    console.log('✅ PASS\n');
    passed++;
  } else {
    console.log('❌ FAIL - Expected false, got', result, '\n');
    failed++;
  }
});

// Summary
console.log('====================================');
console.log('Summary');
console.log('====================================');
console.log(`Total tests: ${passed + failed}`);
console.log(`Passed: ${passed}`);
console.log(`Failed: ${failed}`);

if (failed === 0) {
  console.log('\n✅ All validation tests passed!');
  process.exit(0);
} else {
  console.log('\n❌ Some tests failed!');
  process.exit(1);
}
