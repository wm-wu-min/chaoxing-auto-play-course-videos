// ==UserScript==
// @name         超星学习通单课视频无限循环助手
// @namespace    http://tampermonkey.net/
// @version      1.0
// @description  专为超星学习通打造的单节视频循环播放脚本，去除复杂功能，界面简洁，只做一件事：自动刷单课时长。
// @author       AI Assistant
// @match        *://*.chaoxing.com/*
// @match        *://*.edu.cn/*
// @match        *://*.nbdlib.cn/*
// @match        *://*.hnsyu.net/*
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_xmlhttpRequest
// @require      https://cdn.bootcdn.net/ajax/libs/blueimp-md5/2.19.0/js/md5.min.js
// @run-at       document-end
// ==/UserScript==

(function() {
    'use strict';

    // 仅在包含视频内容的 iframe 页面中执行
    if (location.href.indexOf("knowledge/cards") === -1) return;

    // 工具函数：获取 Cookie
    function getCookie(name) {
        let match = document.cookie.match(new RegExp('(^| )' + name + '=([^;]+)'));
        return match ? match[2] : null;
    }

    // ==== 1. 注入可视化控制面板 ====
    let panel = document.createElement('div');
    panel.style.cssText = 'position:fixed; top:20px; right:20px; z-index:999999; background:#ffffff; border:2px solid #5bc0de; border-radius:8px; padding:15px; box-shadow: 0 4px 10px rgba(0,0,0,0.3); width:280px; font-family:"Microsoft YaHei",sans-serif;';
    panel.innerHTML = `
        <h4 style="margin:0 0 15px 0; color:#31708f; font-weight:bold; font-size:16px; text-align:center;">🔁 视频无限循环助手</h4>

        <div style="margin-bottom:10px; font-size:14px;">
            <label style="cursor:pointer; color:#d9534f; font-weight:bold;">
                <input type="checkbox" id="cx-loop-toggle" style="width:16px;height:16px;vertical-align:middle;"> 开启无限重刷本课
            </label>
        </div>

        <div style="margin-bottom:10px; font-size:14px;">
            <label>播放倍速：<input type="number" id="cx-loop-speed" value="${GM_getValue('cx_speed', 1)}" style="width:60px; padding:2px; border:1px solid #ccc; border-radius:4px; text-align:center;"> 倍</label>
        </div>

        <div id="cx-loop-log" style="font-size:12px; color:#333; line-height:1.6; height:120px; overflow-y:auto; border:1px solid #eee; padding:8px; background:#f9f9f9; border-radius:4px;">
            <span style="color:blue;">[就绪] 正在检测视频信息...</span><br>
        </div>
    `;
    document.body.appendChild(panel);

    let logDiv = document.getElementById('cx-loop-log');
    let loopToggle = document.getElementById('cx-loop-toggle');
    let speedInput = document.getElementById('cx-loop-speed');

    // 恢复之前的开关状态
    loopToggle.checked = GM_getValue('cx_is_looping', false);

    // 监听状态改变并保存
    loopToggle.addEventListener('change', (e) => {
        GM_setValue('cx_is_looping', e.target.checked);
        if (e.target.checked) {
            addLog("已开启循环：本页视频结束后将自动刷新重刷", "green");
        } else {
            addLog("已关闭循环：看完后将停止运行", "orange");
        }
    });

    speedInput.addEventListener('change', (e) => {
        let spd = parseFloat(e.target.value);
        if (spd <= 0) spd = 1;
        GM_setValue('cx_speed', spd);
        addLog(`倍速已调整为: ${spd} 倍`, "blue");
    });

    // 日志打印函数
    function addLog(msg, color = "black") {
        let time = new Date().toLocaleTimeString();
        let span = document.createElement('span');
        span.style.color = color;
        span.innerHTML = `[${time}] ${msg}<br>`;
        logDiv.appendChild(span);
        logDiv.scrollTop = logDiv.scrollHeight;
    }

    // ==== 2. 提取页面课程信息 ====
    let scriptHtml = document.documentElement.innerHTML;
    let mArgMatch = scriptHtml.match(/mArg = (\{.*?\});/);

    if (!mArgMatch) {
        addLog("此页未检测到任务信息。", "red");
        if (loopToggle.checked) {
            addLog("5秒后自动刷新重试...", "green");
            setTimeout(() => location.reload(), 5000);
        }
        return;
    }

    let pageData = JSON.parse(mArgMatch[1]);
    let defaults = pageData.defaults;
    let attachments = pageData.attachments;

    let classId = defaults.clazzId;
    let userId = getCookie('_uid') || getCookie('UID') || defaults.userid;
    let fid = getCookie('fid');
    let reportUrl = defaults.reportUrl;

    // 查找视频任务
    let videoItem = attachments.find(item => item.type === 'video');

    if (!videoItem) {
        addLog("此页没有视频任务。", "red");
        if (loopToggle.checked) {
            addLog("5秒后自动刷新重试...", "green");
            setTimeout(() => location.reload(), 5000);
        }
        return;
    }

    let objectId = videoItem.property.objectid;
    let jobId = videoItem.jobid || "";
    let videoName = videoItem.property.name || "未知视频";
    let otherInfo = videoItem.otherInfo;

    addLog(`发现视频: ${videoName}`);

    // ==== 3. 获取视频详细状态并开始模拟播放 ====
    let statusUrl = `${location.protocol}//${location.host}/ananas/status/${objectId}?k=${fid}&flag=normal&_dc=${Date.now()}`;

    GM_xmlhttpRequest({
        method: "GET",
        url: statusUrl,
        headers: { "Referer": location.href },
        onload: function(res) {
            let videoInfo = JSON.parse(res.responseText);
            let duration = videoInfo.duration;
            let dtoken = videoInfo.dtoken;

            if (!duration) {
                addLog("视频信息无效。", "red");
                return;
            }

            startVideoLoop(duration, dtoken);
        }
    });

    // ==== 4. 核心刷课逻辑 ====
    function startVideoLoop(duration, dtoken) {
        let playTime = 0; // 当前播放秒数
        let isdrag = 0;   // 状态标识
        let tickCount = 0; // 计次器

        addLog(`开始刷课，总时长: ${duration}秒`, "green");

        let loopInterval = setInterval(() => {
            if (!loopToggle.checked) {
                // 如果用户没有开启循环且完成了，或者手动关了，就不强制刷
            }

            let currentSpeed = parseFloat(speedInput.value) || 1;
            playTime += currentSpeed; // 每秒累加一次倍速时长
            let reportPlayTime = Math.ceil(playTime);

            // 超星要求每30秒到60秒上报一次进度
            if (tickCount === 0 || tickCount % 30 === 0 || reportPlayTime >= duration) {

                if (reportPlayTime >= duration) {
                    reportPlayTime = duration;
                    isdrag = 4; // 代表播放结束
                } else if (reportPlayTime > 0) {
                    isdrag = 0; // 正常播放
                }

                // 计算特征校验码 enc
                // 超星标准的 MD5 盐值算法
                let strEc = `[${classId}][${userId}][${jobId}][${objectId}][${reportPlayTime * 1000}][d_yHJ!$pdA~5][${duration * 1000}][0_${duration}]`;
                let enc = md5(strEc);

                // 拼接上报的 URL
                let reqUrl = `${reportUrl}/${dtoken}?clazzId=${classId}&playingTime=${reportPlayTime}&duration=${duration}&clipTime=0_${duration}&objectId=${objectId}&otherInfo=${otherInfo}&jobid=${jobId}&userid=${userId}&isdrag=${isdrag}&view=pc&enc=${enc}&rt=0.9&dtype=Video&_t=${Date.now()}`;

                GM_xmlhttpRequest({
                    method: "GET",
                    url: reqUrl,
                    headers: { "Referer": location.href },
                    onload: function(res) {
                        let result = JSON.parse(res.responseText);
                        if (result.isPassed) {
                            addLog(`任务点已点亮！进度: ${reportPlayTime}/${duration}s`, "blue");
                        } else {
                            addLog(`上报成功，当前进度: ${reportPlayTime}/${duration}s`);
                        }

                        // 如果视频播完了
                        if (isdrag === 4 || reportPlayTime >= duration) {
                            clearInterval(loopInterval);
                            addLog("🎉 本次播放结束！", "green");

                            if (loopToggle.checked) {
                                addLog("🔁 准备执行循环，5秒后自动刷新...", "green");
                                setTimeout(() => location.reload(), 5000);
                            } else {
                                addLog("⏹️ 循环未开启，脚本停止工作。", "orange");
                            }
                        }
                    },
                    onerror: function() {
                        addLog("进度上报失败，网络或跨域错误！", "red");
                    }
                });
            }
            tickCount++;
        }, 1000); // 真实的1秒钟跑一次
    }

})();