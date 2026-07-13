/**
 * Formats an error for logging. JSON.stringify on an Error yields "{}"
 * because its properties are non-enumerable, so prefer stack/message.
 * @param {unknown} error - The error or value to format.
 * @returns {string} - A readable representation.
 */
const formatError = (error) => {
  if (error instanceof Error) {
    return error.stack ?? error.message;
  }
  return JSON.stringify(error, null, 2);
};

export default formatError;
