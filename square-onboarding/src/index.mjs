import { Client, Environment, ApiError } from "square";
import  AWS from 'aws-sdk';

const client = new Client({
  bearerAuthCredentials: {
    accessToken: sandbox_token
  },
environment: Environment.Sandbox,
});

// Load the AWS SDK for Node.js

// Set the region
AWS.config.update({ region: 'us-west-2' }); // Update to your region

// Create DynamoDB service object
const ddb = new AWS.DynamoDB.DocumentClient();


const runThroughAllAccounts = async () => {
  const allAccounts = [];  // Array to hold all accumulated accounts
  let cursor = null;       // Start with no cursor
    console.log(JSON.stringify(client))
  try {
      do {
          // Prepare the API request parameters
          const params = {
            query: {},
            limit: 1
          };

          // Add cursor to params only if it's not undefined
          if (cursor) {
              params.cursor = cursor;
          }

          // Make the API call with the current cursor
          const response = await client.loyaltyApi.searchLoyaltyAccounts(params);

          // Log the result from the current API call
          // console.log(response.result);

          // If response.result has accounts, append them to the allAccounts array
          if (response.result && response.result.loyaltyAccounts) {
              allAccounts.push(...response.result.loyaltyAccounts);
          }

          // Update the cursor from the response, if it exists
          cursor = response.result.cursor;
      } while (cursor);  // Continue while there is a cursor indicating more data
  } catch (error) {
    
      console.log("Error fetching accounts:", error);
  }
  console.log("All accounts:", allAccounts);  // Optional: log all accumulated accounts

  // Add all accounts to DynamoDB
//   await addItemsToDynamoDB(allAccounts);
}

runThroughAllAccounts();


async function addItemsToDynamoDB(items) {
    const tableName = 'LoyaltyUserAlliancePoints';

    // Promise array to hold all the put requests
    const promises = items.map(item => {
        const params = {
            TableName: tableName,
            Item: {
                loyaltyNumber: item.mapping.phone_number,
                loyaltyId: item.id,
                balance: item.balance,
                lifetimePoints: item.lifetimePoints,
                customerId: item.customerId,
                createdAt: item.created_at,
            }
        };

        // Add item to DynamoDB
        return ddb.put(params).promise();
    });

    try {
        // Wait for all Promises to resolve
        await Promise.all(promises);
        console.log('All items have been inserted successfully');
    } catch (error) {
        console.error('Error inserting items:', error);
    }
}

// exports.handler = async (event) => {
//     await runThroughAllAccounts();
// };

runThroughAllAccounts()