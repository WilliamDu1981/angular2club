'use strict';


const User=require('../models/models').User;
const mailService=require('../services/mail');
const util=require('../util/util');
const config=require('../config');
const https=require('https');
const querystring=require('querystring');
const EventProxy=require('eventproxy');
const userService=require('../services/user.service');
/**
 * @description 验证用户帐号是否唯一
 * @param req
 * @param req.params.account {String}需要验证的帐号
 * @param res
 */
exports.unique=function (req,res) {
    User.unique(req.query)
        .then(function (isExist) {
            if(isExist){
                var msg='ACCOUNT_IS_EXIST';
                res.set('X-Error',msg);
                res.status(403).send({msg:msg});
            }else{
                res.json({
                    result:true,
                    msg:'ACCOUNT_IS_NOT_EXIST'
                });
            }
        },function(err){
            res.status(403).send({msg:err});
        });
};

/**
 * @description 注册帐号
 * @param req
 * @param req.body.account {String} 帐号email
 * @param req.body.password {String} 密码
 * @param req.body.nickName {String} 用户昵称
 * @param res
 * @returns {*|any}
 */
exports.signup=function(req,res){

    //验证帐号是否合法
    req.checkBody('account','ACCOUNT_INCORRECT').notEmpty().isEmail();

    //验证昵称是否合法
    req.checkBody('nickName','NICKNAME_INCORRECT').notEmpty().isLength(2,20);

    //验证密码是否合法
    req.checkBody('password','password required and length must between 6-20').notEmpty().isLength(6,10);

    var mapErrors=req.validationErrors(true);

    //如果存在错误，则向客户端返回错误
    if(mapErrors){
        res.set('X-Error','REGISTER_ERROR');
        return res.status(403).send({
            result:false,
            msg:mapErrors
        });
    }

    var reqBody=req.body;

    var account={
        account:reqBody.account,
        nickName:reqBody.nickName,
        hashedPassword:util.hashPW(reqBody.password)
    };

    User.unique({account:account.account})
        .then(function (isExist) {
            //如果帐号已经存在,返回403错误
            if(isExist){
                return res.status(403).send({
                    result:false,
                    msg:'ACCOUNT_IS_EXIST'
                });
            }

            //如果帐号不存在，则创建帐号
            User.create(account,function(err,user){

                if(err){
                    //如果创建帐号发生错误，返回500错误
                    return res.status(500).send({msg:err});
                }

                //帐号创建成功后，发送激活邮件
                mailService
                 .sendActiveMail(user)
                 .then(function (info) {
                    console.log('Send Email Success',info.response);
                 },function (err) {
                    console.error('Send Email Failed',err);
                 });

                //返回用户信息
                res.json(user);
            });
        });
};

/**
 * @description 激活帐号
 * @param req
 * @param req.params.id {ObjectId} 用户id
 * @param res
 */
exports.active=function(req,res){
    User.findById(req.params.id,function(err,user){
        if(err){
            return res.status(500)
                    .send({
                        result:false,
                        msg:err
                    });
        }

        if(!user){
            return res
                .status(404)
                .send({
                    result:false,
                    msg:'USER_NOT_FOUND'
                });
        }

        if(user.get('isActive')){
            return res
                .status(400)
                .send({
                    result:false,
                    msg:'USER_IS_ACTIVED'
                });
        }

        user.set('isActive',true);

        user.save(function(err,doc){
            res.send({msg:'ACTIVE_USER_SUCCESS',result:true});
        });
    });
};

/**
 * @description 用户登录
 * @param req
 * @param req.body.account {String} 帐号email
 * @param req.body.password {String} 密码
 * @param res
 * @returns {*|any}
 */
exports.signin=function(req,res){
    req.checkBody('account','ACCOUNT_REQUIRED&MUST_BE_EMAIL').notEmpty().isEmail();
    req.checkBody('password','PASSWORD_REQUIRED&MUST_BETWEEN_6-20').notEmpty().isLength(6,20);

    var mapErrors=req.validationErrors(true);

    //如果存在错误，则向客户端返回错误
    if(mapErrors){
        res.set('X-Error','LOGIN_ERROR');

        return res.status(403).send({
            result:false,
            msg:mapErrors
        });
    }

    User.findOne({account:req.body.account})
        .exec(function(err,user){
            if(err){
                return res.status(500)
                    .send({
                        result:false,
                        msg:err
                    });
            }

            if(!user){
                return res
                    .status(404)
                    .send({
                        result:false,
                        msg:'USER_NOT_FOUND'
                    });
            }

            if(!user.get('isActive')){
                res.status(403)
                    .send({
                        result:false,
                        msg:'USER_IS_NOT_ACTIVE'
                    });
            }else if(util.hashPW(req.body.password)===user.hashedPassword){
                userService.generateSession(req,res,user)
                    .then(function(data){
                        res.json(data);
                    });
            }else{
                res
                    .status(400)
                    .send({
                        result:false,
                        msg:'PASSWORD_INCORRECT',
                        data:user
                    });
            }
        });
};

exports.update=function(req,res){
    var reqBody=req.body;

    if(reqBody.account||req.password){
        res.status(403).send({result:false,msg:'account don\'t allow to change'});
    }else{
        var update=Object.assign({
            updateAt:Date.now()
        },reqBody);

        if(update.password){
            update.hashedPassword=util.hashPW(update.password);
        }

        User
            .update({$set:update})
            .where('_id').equals(req.session.user)
            .exec(function(err,result){
                if(err){
                    res.status(500).send({result:false,msg:err});
                } else {
                    res.json(result);
                }
            });
    }
};


exports.authQQ=function(req,res){
    let code=req.query.code;
    let ep=new EventProxy();
    let accessToken,openId;

    const FIND_USER_FROM_DB='findUserFromDb';
    const GET_QQ_USER_INFO_SUCCESS='getQQUserInfoSuccess';



    let onGetOpenIdSuccess=function(data){
        openId=data.openid;

        User.findOne()
            .where('openId').equals(openId)
            .exec(function(err,user){
                if(err){
                    return res.status(500).send(err);
                }
                ep.emit(FIND_USER_FROM_DB,user);
            });

        userService.getQQUserInfo(accessToken,openId)
            .then(function(data){
                ep.emit(GET_QQ_USER_INFO_SUCCESS,data);
            });
    };


    ep.all(FIND_USER_FROM_DB,GET_QQ_USER_INFO_SUCCESS,function(user,data){

        var account={
            account:openId,
            openId:openId,
            nickName:data.nickname,
            gender:data.gender,
            avatar:data.figureurl_qq_1,
            province:data.province,
            city:data.city,
            type:2,
            isActive:true
        };

        let onSaveUserSuccess=function(err,doc){

            if(err){
                //如果创建帐号发生错误，返回500错误
                return res.status(500).send({msg:err});
            }

            userService.generateSession(req,res,doc)
                .then(function(doc){
                    res.redirect('/');
                });
        };

        if(user){
            user.save(account,onSaveUserSuccess);
        }else{
            User.create(account,onSaveUserSuccess);
        }

    });


    userService.getQQAccessToken(code)
        .then(function(data){
            accessToken=data.access_token;
            userService.getQQOpenId(accessToken)
                .then(onGetOpenIdSuccess);
        });

};