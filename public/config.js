// Public deployment URL only. Household keys are generated on the device,
// stored locally, and shared in the invitation URL fragment, never in this file.
// The Apps Script backend stays deployed as a fallback; npm run deploy-backend reads its ID here.
export const APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbxjCcFfLvI53oi73jnwOo9b_WCPbfK4yfE99BmOfpM3cFTN4s1CLhlpvxKQwA670TZwgw/exec';
export const BACKEND_URL = APPS_SCRIPT_URL;
