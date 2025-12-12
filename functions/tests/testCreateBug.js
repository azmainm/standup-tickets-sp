/**
 * Test script to create a bug in Jira
 * This tests if we can create issues with work type "Bug"
 */

require("dotenv").config();
const axios = require("axios");

/**
 * Create a test bug in Jira
 */
async function createTestBug() {
  try {
    const { JIRA_URL, JIRA_EMAIL, JIRA_API_TOKEN, JIRA_PROJECT_KEY } = process.env;
    
    if (!JIRA_URL || !JIRA_EMAIL || !JIRA_API_TOKEN) {
      console.error("❌ Missing Jira environment variables");
      console.log("Required: JIRA_URL, JIRA_EMAIL, JIRA_API_TOKEN, JIRA_PROJECT_KEY");
      return;
    }

    const trimmedJiraUrl = JIRA_URL.trim();
    const projectKey = JIRA_PROJECT_KEY || "TDS";
    
    console.log("🧪 Testing Bug Creation in Jira");
    console.log("Project:", projectKey);
    console.log("Jira URL:", trimmedJiraUrl);
    console.log("---");

    // Create authentication header
    const auth = Buffer.from(`${JIRA_EMAIL}:${JIRA_API_TOKEN}`).toString("base64");

    // Step 1: Get Azmain's account ID
    console.log("📝 Step 1: Finding Azmain Morshed's account ID...");
    
    const userSearchResponse = await axios.get(`${trimmedJiraUrl}/rest/api/3/user/search`, {
      headers: {
        "Authorization": `Basic ${auth}`,
        "Accept": "application/json",
      },
      params: {
        query: "Azmain Morshed"
      },
      timeout: 10000,
    });

    let assigneeAccountId = null;
    if (userSearchResponse.data && userSearchResponse.data.length > 0) {
      assigneeAccountId = userSearchResponse.data[0].accountId;
      console.log(`✅ Found: ${userSearchResponse.data[0].displayName} (${assigneeAccountId})`);
    } else {
      console.log("⚠️ Azmain Morshed not found, creating bug without assignee");
    }
    console.log("---");

    // Step 2: Create the bug
    console.log("🐛 Step 2: Creating test bug...");
    
    const bugData = {
      fields: {
        project: {
          key: projectKey
        },
        summary: "TDS-280 test bug",
        description: {
          type: "doc",
          version: 1,
          content: [
            {
              type: "paragraph",
              content: [
                {
                  type: "text",
                  text: "This is a test bug created to verify bug creation functionality. "
                }
              ]
            },
            {
              type: "paragraph",
              content: [
                {
                  type: "text",
                  text: "Issue Details:",
                  marks: [{ type: "strong" }]
                }
              ]
            },
            {
              type: "bulletList",
              content: [
                {
                  type: "listItem",
                  content: [
                    {
                      type: "paragraph",
                      content: [
                        {
                          type: "text",
                          text: "Test bug to verify work type creation"
                        }
                      ]
                    }
                  ]
                },
                {
                  type: "listItem",
                  content: [
                    {
                      type: "paragraph",
                      content: [
                        {
                          type: "text",
                          text: "Assigned to: Azmain Morshed"
                        }
                      ]
                    }
                  ]
                },
                {
                  type: "listItem",
                  content: [
                    {
                      type: "paragraph",
                      content: [
                        {
                          type: "text",
                          text: "Created via test script"
                        }
                      ]
                    }
                  ]
                }
              ]
            }
          ]
        },
        issuetype: {
          name: "Bug"  // ← This is the key part - creating as Bug not Task
        }
      }
    };

    // Add assignee if found
    if (assigneeAccountId) {
      bugData.fields.assignee = {
        accountId: assigneeAccountId
      };
    }

    console.log("Request payload:");
    console.log(JSON.stringify(bugData, null, 2));
    console.log("---");

    const createResponse = await axios.post(
      `${trimmedJiraUrl}/rest/api/3/issue`,
      bugData,
      {
        headers: {
          "Authorization": `Basic ${auth}`,
          "Accept": "application/json",
          "Content-Type": "application/json",
        },
        timeout: 10000,
      }
    );

    console.log("✅ Bug created successfully!");
    console.log("---");
    console.log("📋 Bug Details:");
    console.log(`  Issue Key: ${createResponse.data.key}`);
    console.log(`  Issue ID: ${createResponse.data.id}`);
    console.log(`  URL: ${trimmedJiraUrl}/browse/${createResponse.data.key}`);
    console.log("---");
    console.log("🎉 Test passed! Bug work type is supported.");
    console.log("✅ Ready to implement bug creation in the system.");

  } catch (error) {
    console.error("❌ Test failed!");
    console.error("Error:", error.message);
    
    if (error.response) {
      console.error("Status:", error.response.status);
      console.error("Response:", JSON.stringify(error.response.data, null, 2));
      
      if (error.response.status === 400) {
        console.log("\n💡 Common issues:");
        console.log("  - 'Bug' issue type might not exist in your project");
        console.log("  - Project key might be incorrect");
        console.log("  - Required fields might be missing");
        console.log("\nCheck your Jira project settings for available issue types.");
      }
    } else if (error.code === 'ECONNREFUSED') {
      console.error("❌ Connection refused - check JIRA_URL");
    }
  }
}

// Run the test
console.log("========================================");
console.log("🧪 JIRA BUG CREATION TEST");
console.log("========================================\n");

createTestBug();

