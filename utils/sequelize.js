// Sequelize
const { Sequelize } = require('sequelize');
const { 
  database, 
  user,
  password,
  options,
} = require('../config/database.json');

const sequelize = new Sequelize(database, user, password, options);

module.exports = {
  sequelize,
};