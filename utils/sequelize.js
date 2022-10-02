// Sequelize
const { Sequelize } = require('sequelize');

module.exports = ({ database, user, password, options }) => {
  const sequelize = new Sequelize(database, user, password, options);
  return sequelize;
};