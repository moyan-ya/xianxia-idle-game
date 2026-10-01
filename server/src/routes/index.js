/**
 * 路由汇总
 */
const express = require('express');

const router = express.Router();

router.use('/auth', require('./auth.route'));
router.use('/role', require('./role.route'));
router.use('/bag', require('./bag.route'));
router.use('/shop', require('./shop.route'));
router.use('/battle', require('./battle.route'));
router.use('/rank', require('./rank.route'));
router.use('/game', require('./game.route'));

module.exports = router;
