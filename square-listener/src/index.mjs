import { Client, Environment, ApiError } from "square";
import  AWS from 'aws-sdk';
import crypto from 'crypto';

const test_body = {
  "body": {
    "merchant_id": "C337NFWQT2A6W",
    "type": "loyalty.account.updated",
    "event_id": "3ca83966-230e-4a61-8484-22ea749ea765",
    "created_at": "2020-05-13T01:46:58.794Z",
    "data": {
        "type": "loyalty",
        "id": "ba2f8ab6-e131-46d9-9882-17714404eb49",
        "object": {
            "loyalty_account": {
                "balance": 300,
                "created_at": "2020-05-13T01:41:34Z",
                "customer_id": "QPTXM8PQNX3Q726ZYHPMNP46XC",
                "enrolled_at": "2020-05-13T01:41:34Z",
                "id": "ba2f8ab6-e131-46d9-9882-17714404eb49",
                "lifetime_points": 10,
                "mapping": {
                    "created_at": "2020-05-13T01:41:34Z",
                    "id": "664c22ba-9460-45a5-8917-381ae72dcfdc",
                    "phone_number": "+14155551234"
                },
                "program_id": "5216e8b2-d43e-41e2-9ed8-eccf3e892aef",
                "updated_at": "2020-05-13T01:41:34Z"
            }
        }
    }
  }
}

export const handler = async (event) => {
  // console.log(event)

  const ddb = new AWS.DynamoDB.DocumentClient();

  async function listTables() {
    const dynamoDB = new AWS.DynamoDB();
    try {
        const data = await dynamoDB.listTables({}).promise();
        console.log("Table names in DynamoDB:", data.TableNames);
    } catch (err) {
        console.log("Error", err);
    }
  }
  
  async function getMerchantToken(merchant_id) {
    const dynamoDB = new AWS.DynamoDB.DocumentClient();
    const params = {
        TableName: 'MerchantApiKeys', // Replace 'YOUR_TABLE_NAME' with your table name
        Key: {
            'merchant-id': merchant_id // Adjust the key attribute name if necessary
        }
    };
  
    try {
        const data = await dynamoDB.get(params).promise();
        if (data.Item) {
            // console.log("Sandbox Token:", data.Item.sandbox_token); // Assuming 'sandbox_token' is the attribute name
            return data.Item.sandbox_token; // Returning the sandbox token
        } else {
            console.log("No item found with merchant_id:", merchant_id);
            return null; // No item found
        }
    } catch (err) {
        console.log(merchant_id)
        console.log("Error fetching merchant key:", err);
        throw err; // Rethrow or handle error as needed
    }
  
  }
  
  const getAllOtherMerchantData = async (targetMerchantId) => {
    const dynamoDB = new AWS.DynamoDB.DocumentClient();
    const params = {
      TableName : 'MerchantApiKeys',
      FilterExpression: "merchant_id <> :targetMerchantId",
      ExpressionAttributeValues: {
          ":targetMerchantId": targetMerchantId
      }
    };
    let allItems = [];
    let lastEvaluatedKey = null;
  
    try {
          do {
              let params = {
                  TableName:'MerchantApiKeys',
                  FilterExpression: "merchant_id <> :targetMerchantId",
                  ExpressionAttributeValues: {
                      ":targetMerchantId": targetMerchantId
                  },
                  ExclusiveStartKey: lastEvaluatedKey
              };
  
              const data = await dynamoDB.scan(params).promise();
              allItems = allItems.concat(data.Items);
              lastEvaluatedKey = data.LastEvaluatedKey;
              console.log("Scanning for more...");
          } while (lastEvaluatedKey);
          
          console.log('Scan completed. Total items received:', allItems.length);
          return allItems.map(item => item.sandbox_token);;
      } catch (error) {
          console.error("Scan failed:", error);
          throw error; // Rethrowing the error after logging it to handle it further up the call stack if necessary
      }
  
  }
  
  
  const createClients = async (tokens) => {
    const clients = tokens.map(token => { 
      return new Client({
        bearerAuthCredentials: {
          accessToken: token
        },
        environment: Environment.Sandbox,
      })
    })
    return clients;
  }

  const clients = await createClients(await getAllOtherMerchantData('C337NFWQT2A6W'))

  const manageLoyaltyPoints = async (client, target_points) => {

    
    try {
          // First operation: Search for loyalty accounts
          const searchResponse = await client.loyaltyApi.searchLoyaltyAccounts({
              query: {
                  mappings: [
                      { phoneNumber: '+15713869946' }
                  ]
              },
              limit: 1
          });
          console.log(searchResponse.result);
          if (!searchResponse.result.loyaltyAccounts || !searchResponse.result.loyaltyAccounts.length > 0) {
            console.log('No More loyalty accounts found.');
            return;  // Exit if no accounts are found
          }

          const account = searchResponse.result.loyaltyAccounts[0];
          const current_point_balance = account.balance;
          if (target_points - current_point_balance === 0) {
            console.log('Preventing a 0 point adjustment');
            return;
          }
          // Second operation: Adjust loyalty points
          const adjustResponse = await client.loyaltyApi.adjustLoyaltyPoints(
            account.id,
            {
              idempotencyKey: crypto.randomBytes(16).toString('hex'),
              adjustPoints: {
                points: target_points - current_point_balance,
                reason: 'Alliance Sync'
              }
            });

          console.log(adjustResponse.result);
      } catch (error) {
          console.log(error);  // Logs errors from either of the try blocks
      }
  }

// Call the function



  const webhook_body = event.body
  // New Loyalty User - Add User to DB and Create Loyalty Accounts for other alliance members


  // Updated Points Amount - Update DB Value and Broadcast New Amount to Alliance Members
  const new_user_point_value = event.body.data.object.loyalty_account.balance
  if(webhook_body.type === 'loyalty.account.updated' ){
    console.log('Attempting the update')
    const clients  = await createClients(await getAllOtherMerchantData('C337NFWQT2A6W'))
    for (const client of clients) {
      await manageLoyaltyPoints(client, new_user_point_value)
    }


    const updateBalance  = async (loyaltyIdentifier, newBalance) => {
      const params = {
        TableName: "LoyaltyUserAlliancePoints",
        Key: {
          "LoyaltyIdentifier": loyaltyIdentifier
        },
        UpdateExpression: "set balance = :b",
        ExpressionAttributeValues: {
          ":b": newBalance
        },
        ReturnValues: "UPDATED_NEW"  // You can specify what is returned. "UPDATED_NEW" returns the value of the updated item attributes after the update.
      };
    
      ddb.update(params, (err, data) => {
        if (err) {
          console.error("Unable to update item. Error JSON:", JSON.stringify(err, null, 2));
        } else {
          console.log("UpdateItem succeeded:", JSON.stringify(data, null, 2));
        }
      });
    };
    await updateBalance(webhook_body.data.object.loyalty_account.mapping.phone_number, new_user_point_value)
  }
  // Redeemed Points - Update DB Value and Broadcast New Amount to Alliance Members

}


async function listTables() {
  const dynamoDB = new AWS.DynamoDB();
  try {
      const data = await dynamoDB.listTables({}).promise();
      console.log("Table names in DynamoDB:", data.TableNames);
  } catch (err) {
      console.log("Error", err);
  }
}

async function getMerchantToken(merchant_id) {
  const dynamoDB = new AWS.DynamoDB.DocumentClient();
  const params = {
      TableName: 'Merchant-Api-Keys', // Replace 'YOUR_TABLE_NAME' with your table name
      Key: {
          'Merchant-Id': merchant_id // Adjust the key attribute name if necessary
      }
  };

  try {
      const data = await dynamoDB.get(params).promise();
      if (data.Item) {
          // console.log("Sandbox Token:", data.Item.sandbox_token); // Assuming 'sandbox_token' is the attribute name
          return data.Item.sandbox_token; // Returning the sandbox token
      } else {
          console.log("No item found with merchant_id:", merchant_id);
          return null; // No item found
      }
  } catch (err) {
      console.log("Error fetching merchant key:", err);
      throw err; // Rethrow or handle error as needed
  }

}

const getAllOtherMerchantData = async (targetMerchantId) => {
  const dynamoDB = new AWS.DynamoDB.DocumentClient();
  const params = {
    TableName : 'MerchantApiKeys',
    FilterExpression: "merchant_id <> :targetMerchantId",
    ExpressionAttributeValues: {
        ":targetMerchantId": targetMerchantId
    }
  };
  let allItems = [];
  let lastEvaluatedKey = null;

  try {
        do {
            let params = {
                TableName:'MerchantApiKeys',
                FilterExpression: "merchant_id <> :targetMerchantId",
                ExpressionAttributeValues: {
                    ":targetMerchantId": targetMerchantId
                },
                ExclusiveStartKey: lastEvaluatedKey
            };

            const data = await dynamoDB.scan(params).promise();
            allItems = allItems.concat(data.Items);
            lastEvaluatedKey = data.LastEvaluatedKey;
            console.log("Scanning for more...");
        } while (lastEvaluatedKey);
        
        console.log('Scan completed. Total items received:', allItems.length);
        return allItems.map(item => item.sandbox_token);;
    } catch (error) {
        console.error("Scan failed:", error);
        throw error; // Rethrowing the error after logging it to handle it further up the call stack if necessary
    }

}


const createClients = async (tokens) => {
  const clients = tokens.map(token => { 
    return new Client({
      bearerAuthCredentials: {
        accessToken: token
      },
      environment: Environment.Sandbox,
    })
  })
  return clients;
}


// console.log(await getAllOtherMerchantData('C337NFWQT2A6W'))
// const clients  = await createClients(await getAllOtherMerchantData('C337NFWQT2A6W'))

// listTables();
handler(test_body)






