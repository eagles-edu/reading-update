getMyCookie = function (name) {
    var value = document.cookie.split(/;\s*/).find((row) => row.startsWith(name));
    if (value) {
        return decodeURIComponent(value.split("=")[1]);
    }
    return "";
};

let curr_page_url = window.location.href;
let curr_content_id = window.location.hostname.replace(/[^\/]*:\/\//, "").replace(/^www\./, "").replace(/(.*)\.[^\.]+$/, "$1") + "_" + document.location.pathname.replace(/^\//, "").replaceAll(/\//g, "_").replace(/\.html?$/, "");
let curr_user_login_token = (new URLSearchParams(window.location.search).get("token") || getMyCookie("login_token"));
var curr_user_actv_sts = 0;
var page_key =Math.floor(Date.now() + Math.random());
//alert(document.readyState);
if(document.readyState === 'loading') {
  localStorage.setItem("page_key", page_key);
//  alert(page_key);
}

Date.prototype.today = function () {
    return this.getFullYear() +"-"+(((this.getMonth()+1) < 10)?"0":"") + (this.getMonth()+1) +"-"+ ((this.getDate() < 10)?"0":"") + this.getDate() ;
}

// For the time now
Date.prototype.timeNow = function () {
     return ((this.getHours() < 10)?"0":"") + this.getHours() +":"+ ((this.getMinutes() < 10)?"0":"") + this.getMinutes() +":"+ ((this.getSeconds() < 10)?"0":"") + this.getSeconds();
}

jQuery.ajax({
    type: 'POST',
    dataType : 'json',
    url: `https://www.eslfast.com/membership/api/valid-token/${curr_user_login_token}`
}).done(function (res) {
    //update_active_on_page(curr_page_url, curr_content_id, curr_user_login_token);

    if ((res.token_key != '') /*&& (res.memb_status == 1)*/) {
        curr_user_actv_sts = 1;
        setInterval(function () {
//            let curr_date = new Date().today();
//            let datetime = new Date().today() + " " + new Date().timeNow();
//            console.log(datetime);
            update_active_on_page(curr_page_url, curr_content_id, curr_user_login_token);
        }, 130000);
    }
}).fail(function (jqXHR, textStatus) {

});
update_active_on_page = (curr_page_url, curr_content_id, curr_user_login_token) => {
  let curr_date = new Date().today();
  let curr_datetime = new Date().today() + " " + new Date().timeNow();
  jQuery.ajax({
    type: 'POST',
    dataType : 'json',
    data:{curr_page_url:curr_page_url, curr_content_id:curr_content_id, curr_user_login_token:curr_user_login_token,curr_date: curr_date, curr_datetime:curr_datetime, page_key:page_key},
    url: `https://www.eslfast.com/membership/api/time-spend-course/`
    }).done(function (res) {

    }).fail(function (jqXHR, textStatus) {

    });
}
// Every 3 min 1reward
let rewardTimer = null;
let confirmTimer = null;

let lastActivity = Date.now();
let popupShowing = false;
let rewardStopped = false;

// User activity events
[
    "mousemove",
    "mousedown",
    "click",
    "scroll",
    "keydown",
    "touchstart"
].forEach(function (event) {
    document.addEventListener(event, function () {
        lastActivity = Date.now();
    }, true);
});

// User switches tab
document.addEventListener("visibilitychange", function () {
    if (!document.hidden) {
        lastActivity = Date.now();
    }
});

// Start reward timer
rewardTimer = setInterval(checkReward, 180000); // Every 3 min

function checkReward() {

    if (rewardStopped)
        return;

    // inactive for 7 min
    let inactiveTime = Date.now() - lastActivity;

    if (inactiveTime >= 420000) {

        if (!popupShowing) {
            askUserActive();
        }

        return;
    }

    every3minReward(
        curr_page_url,
        curr_content_id,
        curr_user_login_token
    );
}

function askUserActive() {
    if(curr_user_actv_sts == 0){
      return;
    }
    popupShowing = true;

    showDialog({
        title: "Activity Check",
        message: "You've been inactive for a while.<br><br>Click <b>Continue</b> to keep earning rewards.",
        okText: "Continue",
        showCancel: true,

        onOk: function () {

            popupShowing = false;

            lastActivity = Date.now();

            every3minReward(
                curr_page_url,
                curr_content_id,
                curr_user_login_token
            );
        },

        onCancel: function () {

            popupShowing = false;

            stopRewardSystem();
        }
    });

}

function stopRewardSystem() {

    rewardStopped = true;

    clearInterval(rewardTimer);

    showDialog({
        title: "Reward Stopped",
        message: "Reward tracking has been stopped because no activity was detected.",
        okText: "Close",
        showCancel: false
    });
}

function every3minReward(curr_page_url, curr_content_id, curr_user_login_token) {

    let curr_date = new Date().today();

    $.ajax({
        type: "POST",
        dataType: "json",
        url: "https://www.eslfast.com/membership/api/everyThreeMinReward/",
        data: {
            curr_page_url,
            curr_content_id,
            curr_user_login_token,
            curr_date,
            page_key
        }
    })
    .done(function(res){

        if(res.status === "error"){

          const storageKey = "every3minRewardErrorShown";
            const now = Date.now();

            // 10 minutes
            const showAgainAfter = 120 * 60 * 1000;

            const lastShown = localStorage.getItem(storageKey);

            // Show only if never shown OR 10 minutes have passed
            if (!lastShown || (now - parseInt(lastShown)) >= showAgainAfter) {
              showInvalidLoginPopup(
                  res.msg +
                  `<div>
                      <a href="https://www.eslfast.com/"
                        style="display:inline-block;padding:12px 24px;background:#ff4d4d;color:#fff;text-decoration:none;border-radius:10px;font-weight:bold;">
                          Sign In Now
                      </a>
                  </div>`
              );
              // Save current time
              localStorage.setItem(storageKey, now);
            }
        }

    });
}

function showDialog(options = {}) {

    // Remove old dialog if exists
    const old = document.getElementById("customDialog");
    if (old) old.remove();

    const dialog = document.createElement("div");
    dialog.id = "customDialog";

    dialog.innerHTML = `
        <div class="dialog-overlay"></div>

        <div class="dialog-box">

            <div class="dialog-title">${options.title || "Message"}</div>

            <div class="dialog-body">
                ${options.message || ""}
            </div>

            <div class="dialog-footer">
                ${
                    options.showCancel !== false
                    ? `<button class="dialog-btn dialog-cancel">Cancel</button>`
                    : ""
                }

                <button class="dialog-btn dialog-ok">
                    ${options.okText || "OK"}
                </button>
            </div>

        </div>
    `;

    document.body.appendChild(dialog);

    if (!document.getElementById("dialogStyle")) {

        const style = document.createElement("style");

        style.id = "dialogStyle";

        style.innerHTML = `
        #customDialog{
            position:fixed;
            inset:0;
            z-index:999999;
        }

        .dialog-overlay{
            position:absolute;
            inset:0;
            background:rgba(0,0,0,.45);
        }

        .dialog-box{
            position:absolute;
            left:50%;
            top:50%;
            transform:translate(-50%,-50%);
            width:380px;
            max-width:90%;
            background:#fff;
            border-radius:10px;
            overflow:hidden;
            font-family:Arial,sans-serif;
            box-shadow:0 10px 30px rgba(0,0,0,.3);
        }

        .dialog-title{
            padding:15px;
            font-size:18px;
            font-weight:bold;
            border-bottom:1px solid #ddd;
        }

        .dialog-body{
            padding:20px;
            line-height:1.5;
        }

        .dialog-footer{
            padding:15px;
            text-align:right;
            border-top:1px solid #ddd;
        }

        .dialog-btn{
            padding:8px 20px;
            margin-left:10px;
            cursor:pointer;
            border:none;
            border-radius:5px;
        }

        .dialog-ok{
            background:#0d6efd;
            color:#fff;
        }

        .dialog-cancel{
            background:#6c757d;
            color:#fff;
        }
        `;

        document.head.appendChild(style);
    }

    dialog.querySelector(".dialog-ok").onclick = function () {

        dialog.remove();

        if (typeof options.onOk === "function")
            options.onOk();
    };

    const cancel = dialog.querySelector(".dialog-cancel");

    if (cancel) {
        cancel.onclick = function () {

            dialog.remove();

            if (typeof options.onCancel === "function")
                options.onCancel();
        };
    }
}
//------

//const chat_socket = 'https://socket.eslfast.com/';
//const socket = io(chat_socket, {
//                query: { userId: curr_user_login_token, pageId: curr_content_id  }
//            });
//
//socket.emit('joinRoom', curr_content_id);
//
//socket.on('userOnline', (data) => {
//    const { userId, pageId } = data;
//    alert(`User ${userId} is now online ${pageId}`);
//});
//socket.on('userOffline', (data) => {
//    const { userId, pageId } = data;
//    alert(`User ${userId} is now offline ${pageId} `);
//});

 function completePageTask(point = 5){
    // alert('vv : '+ curr_user_actv_sts);
    let curr_datetime = new Date().today() + " " + new Date().timeNow();
    if(curr_user_actv_sts == 1){
        jQuery.ajax({
            type: 'POST',
            dataType : 'json',
            data:{curr_page_url:curr_page_url,
                curr_content_id:curr_content_id,
                curr_user_login_token:curr_user_login_token,
                curr_datetime:curr_datetime,
                page_key:page_key,
                point:point
              },
            url: `https://www.eslfast.com/membership/api/page-task-complete/`
            }).done(function (res) {
                if(res.status=="success"){
                    showLessonCompleteAnimation(res.total_point, point);
                    //If promte
                    if(res.promot_status == 1){
                        setTimeout(function() {
                            let parentDivxc = $('.lesson-complete-popup').parent('div');
                            if (parentDivxc.length) {
                                parentDivxc.remove();
                            }
                            const audiox = new Audio('https://www.eslfast.com/js/sound/applause_sound.mp3');
                            audiox.play().catch(err => {
                              console.warn('Audio permission denied:', err.message);
                            });

                            let prom_txt = `${res.medal_tire} unlocked! Your excellence is now officially tiered .<img src='https://www.eslfast.com/js/img/Medal_Tier_${res.medal_tire}.png' width='50' />`;
                            showLessonCompleteAnimationText(prom_txt);
                        }, 1000);
                    }
                }else{
                  if (res && typeof res === 'object' && 'msg' in res) {
                      if(res.msg == "Already completed"){
                        showAlreadyCompletedPopup();
                        deleteCookieIfPresent('pageQuestionAnswer');
                      }else{
                        showInvalidLoginPopup(res.msg);
                      }
                  }else{
                    showTryAgainPopup();
                  }
                }
            }).fail(function (jqXHR, textStatus) {

            });
    }
 }

 //point for dictation
 function completeDictPageTask(point = 5){
    // alert('vv : '+ curr_user_actv_sts);
    let curr_datetime = new Date().today() + " " + new Date().timeNow();
    // if(curr_user_actv_sts == 1){
        jQuery.ajax({
            type: 'POST',
            dataType : 'json',
            data:{curr_page_url:curr_page_url,
                curr_content_id:curr_content_id,
                curr_user_login_token:curr_user_login_token,
                curr_datetime:curr_datetime,
                page_key:page_key,
                point:point
              },
            url: `https://www.eslfast.com/membership/api/page-task-complete/`
            }).done(function (res) {
                if(res.status=="success"){
                    showLessonCompleteAnimation(res.total_point, point);
                    //If promte
                    if(res.promot_status == 1){
                        setTimeout(function() {
                            let parentDivxc = $('.lesson-complete-popup').closest('div');
                            if (parentDivxc.length) {
                                parentDivxc.remove();
                            }
                            const audiox = new Audio('https://www.eslfast.com/js/sound/applause_sound.mp3');
                            audiox.play().catch(err => {
                              console.warn('Audio permission denied:', err.message);
                            });

//                            let prom_txt = `${res.medal_tire} unlocked! Your excellence is now officially tiered .<img src='https://www.eslfast.com/js/img/Medal_Tier_${res.medal_tire}.png' width='50' />`;
//                            showLessonCompleteAnimationText(prom_txt);
                            showTierPromotionPopup(res.medal_tire);
                        }, 1000);
                    }
                }else{
                  if (res && typeof res === 'object' && 'msg' in res) {
                      if(res.msg == "Already completed"){
                        showAlreadyCompletedPopup();
                        deleteCookieIfPresent('pageQuestionAnswer');
                      }else{
                        showInvalidLoginPopup(res.msg);
                      }
                  }else{
                    showTryAgainPopup();
                  }
                }
            }).fail(function (jqXHR, textStatus) {

            });
    // }
 }

function showLessonCompleteAnimation(total_point, curr_point = 5) {
  // Try to play audio
  const audio = new Audio('https://www.eslfast.com/js/sound/sound1.mp3');
  audio.play().catch(err => {
    console.warn('Audio permission denied:', err.message);
  });

  // Random praise phrase
  const phrases = ["Great Job!", "Well Done!", "Awesome!", "Amazing!", "Excellent!", "Great!"];
  const randomPhrase = phrases[Math.floor(Math.random() * phrases.length)];

  // Create overlay
  const overlay = document.createElement('div');
  Object.assign(overlay.style, {
    position: 'fixed',
    top: 0,
    left: 0,
    width: '100vw',
    height: '100vh',
    backgroundColor: 'rgba(0,0,0,0.5)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 9999,
    padding: '20px',
  });

  // Create popup
  const popup = document.createElement('div');
  popup.className = 'lesson-complete-popup';
  Object.assign(popup.style, {
    background: 'linear-gradient(135deg, #fff8dc, #e0ffe0)',
    borderRadius: '20px',
    padding: '30px 20px',
    boxShadow: '0 0 30px rgba(0,0,0,0.3)',
    textAlign: 'center',
    position: 'relative',
    animation: 'bounceIn 0.8s ease-out, glowPulse 3s infinite alternate',
    maxWidth: '90%',
    width: '400px',
    fontFamily: 'Segoe UI, sans-serif',
    color: '#1a1a1a',
    overflow: 'hidden',
  });

  // Character Image
  const character = document.createElement('img');
  character.src = 'https://www.eslfast.com/js/img/susan3.jpg';
  Object.assign(character.style, {
    width: '100px',
    borderRadius: '50%',
    animation: 'floatSwing 3s ease-in-out infinite',
    marginBottom: '15px',
    display: 'block',
    marginLeft: 'auto',
    marginRight: 'auto'
  });

  // Heading
  const heading = document.createElement('h2');
  heading.innerText = '🎉 Completed!';
  Object.assign(heading.style, {
    marginBottom: '15px',
    fontSize: '28px',
    color: '#006400',
    textAlign: 'center',
  });

  // Random praise
  const praise = document.createElement('p');
  praise.innerText = randomPhrase;
  Object.assign(praise.style, {
    fontSize: '22px',
    color: '#222',
    fontWeight: 'bold',
    marginBottom: '20px',
    textAlign: 'center',
  });

  // Subtext
  const subtext = document.createElement('p');
  subtext.innerHTML = `<div style="text-align:center;">
   ${curr_point > 0 ? `You’ve earned <strong>⚡${curr_point} points</strong>` : ''}
   ${total_point > 0 ? `<br>and <strong>${total_point} total points</strong> so far!` : ''}
</div>`;
  Object.assign(subtext.style, {
    fontSize: '18px',
    color: '#333',
    marginBottom: '20px',
    textAlign: 'center',
  });

  // Close button
  const closeBtn = document.createElement('div');
  closeBtn.innerHTML = '&times;';
  Object.assign(closeBtn.style, {
    position: 'absolute',
    top: '0px',
    right: '7px',
    fontSize: '26px',
    color: '#666',
    cursor: 'pointer',
    border: '1px dotted',
    padding: '0px 8px 0px 8px'
  });
  closeBtn.onclick = () => overlay.remove();

  // Append elements
  popup.appendChild(closeBtn);
  popup.appendChild(character);
  popup.appendChild(heading);
  popup.appendChild(praise);
  popup.appendChild(subtext);
  overlay.appendChild(popup);
  document.body.appendChild(overlay);

  // Confetti animation
  for (let i = 0; i < 50; i++) {
    const confetti = document.createElement('div');
    Object.assign(confetti.style, {
      position: 'fixed',
      top: '50%',
      left: '50%',
      width: '8px',
      height: '8px',
      backgroundColor: `hsl(${Math.random()*360}, 100%, 50%)`,
      borderRadius: '50%',
      transform: `translate(-50%, -50%)`,
      animation: `confettiFly ${1 + Math.random()*1.5}s ease-out forwards`,
      zIndex: 10000
    });
    confetti.style.setProperty('--x', `${(Math.random() - 0.5) * 400}px`);
    confetti.style.setProperty('--y', `${(Math.random() - 0.5) * 400}px`);
    document.body.appendChild(confetti);
    setTimeout(() => confetti.remove(), 3000);
  }

  // Style animations
  const style = document.createElement('style');
  style.textContent = `
    @keyframes bounceIn {
      0% { transform: scale(0.7); opacity: 0; }
      80% { transform: scale(1.1); opacity: 1; }
      100% { transform: scale(1); }
    }
    @keyframes floatSwing {
      0%, 100% { transform: translateY(0) rotate(0deg); }
      50% { transform: translateY(-10px) rotate(3deg); }
    }
    @keyframes glowPulse {
      0% { box-shadow: 0 0 10px #aaffaa; }
      100% { box-shadow: 0 0 30px #55ff55; }
    }
    @keyframes confettiFly {
      to {
        transform: translate(calc(-50% + var(--x)), calc(-50% + var(--y))) rotate(720deg);
        opacity: 0;
      }
    }

    /* Responsive */
    @media (max-width: 768px) {
      .lesson-complete-popup {
        width: 90% !important;
        padding: 20px 15px !important;
      }
    }

    @media (max-width: 480px) {
      .lesson-complete-popup {
        width: 95% !important;
        font-size: 16px !important;
      }
    }
  `;
  document.head.appendChild(style);
}

function showLessonCompleteAnimationText(txt_msg) {
  // Try to play audio
  const audio = new Audio('https://www.eslfast.com/js/sound/sound1.mp3');
  audio.play().catch(err => {
    console.warn('Audio permission denied:', err.message);
  });

  // Random praise phrase
  const phrases = ["Great Job!", "Well Done!", "Awesome!", "Amazing!", "Excellent!", "Great!"];
  const randomPhrase = phrases[Math.floor(Math.random() * phrases.length)];

  // Create overlay
  const overlay = document.createElement('div');
  Object.assign(overlay.style, {
    position: 'fixed',
    top: 0,
    left: 0,
    width: '100vw',
    height: '100vh',
    backgroundColor: 'rgba(0,0,0,0.5)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 9999,
    padding: '20px',
  });

  // Create popup
  const popup = document.createElement('div');
  popup.className = 'lesson-complete-popup';
  Object.assign(popup.style, {
    background: 'linear-gradient(135deg, #fff8dc, #e0ffe0)',
    borderRadius: '20px',
    padding: '30px 20px',
    boxShadow: '0 0 30px rgba(0,0,0,0.3)',
    textAlign: 'center',
    position: 'relative',
    animation: 'bounceIn 0.8s ease-out, glowPulse 3s infinite alternate',
    maxWidth: '90%',
    width: '400px',
    fontFamily: 'Segoe UI, sans-serif',
    color: '#1a1a1a',
    overflow: 'hidden',
  });

  // Character Image
  const character = document.createElement('img');
  character.src = 'https://www.eslfast.com/js/img/susan3.jpg';
  Object.assign(character.style, {
    width: '100px',
    borderRadius: '50%',
    animation: 'floatSwing 3s ease-in-out infinite',
    marginBottom: '15px',
    display: 'block',
    marginLeft: 'auto',
    marginRight: 'auto'
  });

  // Heading
  const heading = document.createElement('h2');
  heading.innerText = '🎉 Completed!';
  Object.assign(heading.style, {
    marginBottom: '15px',
    fontSize: '28px',
    color: '#006400',
    textAlign: 'center',
  });

  // Random praise
  const praise = document.createElement('p');
  praise.innerText = randomPhrase;
  Object.assign(praise.style, {
    fontSize: '22px',
    color: '#222',
    fontWeight: 'bold',
    marginBottom: '20px',
    textAlign: 'center',
  });

  // Subtext
  const subtext = document.createElement('p');
  subtext.innerHTML = `<div style="text-align:center;">${txt_msg}</div>`;
  Object.assign(subtext.style, {
    fontSize: '18px',
    color: '#333',
    marginBottom: '20px',
    textAlign: 'center',
  });

  // Close button
  const closeBtn = document.createElement('div');
  closeBtn.innerHTML = '&times;';
  Object.assign(closeBtn.style, {
    position: 'absolute',
    top: '0px',
    right: '7px',
    fontSize: '26px',
    color: '#666',
    cursor: 'pointer',
    border: '1px dotted',
    padding: '0px 8px 0px 8px'
  });
  closeBtn.onclick = () => overlay.remove();

  // Append elements
  popup.appendChild(closeBtn);
  popup.appendChild(character);
  popup.appendChild(heading);
  popup.appendChild(praise);
  popup.appendChild(subtext);
  overlay.appendChild(popup);
  document.body.appendChild(overlay);

  // Confetti animation
  for (let i = 0; i < 50; i++) {
    const confetti = document.createElement('div');
    Object.assign(confetti.style, {
      position: 'fixed',
      top: '50%',
      left: '50%',
      width: '8px',
      height: '8px',
      backgroundColor: `hsl(${Math.random()*360}, 100%, 50%)`,
      borderRadius: '50%',
      transform: `translate(-50%, -50%)`,
      animation: `confettiFly ${1 + Math.random()*1.5}s ease-out forwards`,
      zIndex: 10000
    });
    confetti.style.setProperty('--x', `${(Math.random() - 0.5) * 400}px`);
    confetti.style.setProperty('--y', `${(Math.random() - 0.5) * 400}px`);
    document.body.appendChild(confetti);
    setTimeout(() => confetti.remove(), 3000);
  }

  // Style animations
  const style = document.createElement('style');
  style.textContent = `
    @keyframes bounceIn {
      0% { transform: scale(0.7); opacity: 0; }
      80% { transform: scale(1.1); opacity: 1; }
      100% { transform: scale(1); }
    }
    @keyframes floatSwing {
      0%, 100% { transform: translateY(0) rotate(0deg); }
      50% { transform: translateY(-10px) rotate(3deg); }
    }
    @keyframes glowPulse {
      0% { box-shadow: 0 0 10px #aaffaa; }
      100% { box-shadow: 0 0 30px #55ff55; }
    }
    @keyframes confettiFly {
      to {
        transform: translate(calc(-50% + var(--x)), calc(-50% + var(--y))) rotate(720deg);
        opacity: 0;
      }
    }

    /* Responsive */
    @media (max-width: 768px) {
      .lesson-complete-popup {
        width: 90% !important;
        padding: 20px 15px !important;
      }
    }

    @media (max-width: 480px) {
      .lesson-complete-popup {
        width: 95% !important;
        font-size: 16px !important;
      }
    }
  `;
  document.head.appendChild(style);
}

function showAlreadyCompletedPopup() {
  // Play audio
  // const audio = new Audio('https://www.eslfast.com/js/sound/sound2.mp3');
  // audio.play().catch(err => {
  //   console.warn('Audio blocked:', err.message);
  // });

  // Create overlay
  const overlay = document.createElement('div');
  Object.assign(overlay.style, {
    position: 'fixed',
    top: '0',
    left: '0',
    width: '100vw',
    height: '100vh',
    backgroundColor: 'rgba(0,0,0,0.5)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: '9999',
    padding: '20px',
  });

  // Create popup box
  const popup = document.createElement('div');
  popup.className = 'already-complete-popup';
  Object.assign(popup.style, {
    background: 'linear-gradient(135deg, #003030, #004040)',
    borderRadius: '20px',
    padding: '30px 20px',
    boxShadow: '0 0 30px rgba(0,0,0,0.4)',
    position: 'relative',
    animation: 'slideBounce 0.8s ease-out',
    maxWidth: '90%',
    width: '400px',
    color: '#ffffff',
    textAlign: 'center',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    fontFamily: 'Segoe UI, sans-serif',
  });

  // Icon
  const mascot = document.createElement('div');
  mascot.innerText = '✅';
  Object.assign(mascot.style, {
    fontSize: '50px',
    animation: 'pulseGlow 1.5s infinite',
    marginBottom: '15px',
    textAlign: 'center'
  });

  // Title
  const title = document.createElement('h2');
  title.innerText = 'Already Completed!';
  Object.assign(title.style, {
    fontSize: '26px',
    color: '#00ffaa',
    marginBottom: '10px',
    textAlign: 'center'
  });

  // Message
  const message = document.createElement('p');
  message.innerHTML = 'You’ve already finished this activity.<br>No need to do it again!';
  Object.assign(message.style, {
    fontSize: '18px',
    color: '#eeeeee',
    marginBottom: '15px',
    lineHeight: '1.5',
    textAlign: 'center'
  });

  // Close Button
  const closeBtn = document.createElement('div');
  closeBtn.innerHTML = '&times;';
  Object.assign(closeBtn.style, {
    position: 'absolute',
    top: '0px',
    right: '7px',
    fontSize: '26px',
    color: '#00ffaa',
    cursor: 'pointer',
    textAlign: 'center',
  });
  closeBtn.onclick = () => overlay.remove();

  // Assemble popup
  popup.appendChild(closeBtn);
  popup.appendChild(mascot);
  popup.appendChild(title);
  popup.appendChild(message);
  overlay.appendChild(popup);
  document.body.appendChild(overlay);

  // Animations and responsive styles
  const style = document.createElement('style');
  style.textContent = `
    @keyframes pulseGlow {
      0% { transform: scale(1); text-shadow: 0 0 5px #00ffaa; }
      50% { transform: scale(1.15); text-shadow: 0 0 15px #00ffaa; }
      100% { transform: scale(1); text-shadow: 0 0 5px #00ffaa; }
    }

    @keyframes slideBounce {
      0% { transform: translateY(-100px); opacity: 0; }
      70% { transform: translateY(10px); opacity: 1; }
      100% { transform: translateY(0); }
    }

    @media (max-width: 768px) {
      .already-complete-popup {
        width: 90% !important;
        padding: 20px 15px !important;
      }
    }

    @media (max-width: 480px) {
      .already-complete-popup {
        width: 95% !important;
        font-size: 16px !important;
      }
    }
  `;
  document.head.appendChild(style);
}

function showTryAgainPopup(Output_txt = '', point = 0) {
  // Create overlay
  const overlay = document.createElement('div');
  Object.assign(overlay.style, {
    position: 'fixed',
    top: '0',
    left: '0',
    width: '100vw',
    height: '100vh',
    backgroundColor: 'rgba(0,0,0,0.6)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: '9999',
    padding: '20px'
  });

  // Create popup
  const popup = document.createElement('div');
  popup.className = 'try-again-popup';
  Object.assign(popup.style, {
    background: 'linear-gradient(135deg, #400202, #300000)',
    borderRadius: '20px',
    padding: '30px 20px',
    boxShadow: '0 0 25px rgba(0,0,0,0.4)',
    maxWidth: '90%',
    width: '400px',
    color: '#ffffff',
    textAlign: 'center',
    fontFamily: 'Segoe UI, sans-serif',
    animation: 'slideBounce 0.8s ease-out',
    position: 'relative'
  });

  // Animated Mascot Image
  const mascot = document.createElement('div');
  mascot.innerHTML = `<img src="https://www.eslfast.com/js/img/susan3.jpg" style="width: 80px;">`;
  Object.assign(mascot.style, {
    animation: 'shake 1s infinite',
    marginBottom: '15px',
    textAlign: 'center'
  });

  // Title
  const title = document.createElement('h2');
  title.textContent = 'You made some mistakes.';
  Object.assign(title.style, {
    fontSize: '24px',
    color: '#ff6666',
    marginBottom: '10px',
    textAlign: 'center'
  });

  // Dynamic output
  const messageOutput = document.createElement('div');
  messageOutput.innerHTML = Output_txt;
  Object.assign(messageOutput.style, {
    fontSize: '16px',
    color: '#ffffff',
    marginBottom: '10px',
    lineHeight: '1.5',
    textAlign: 'center'
  });

  // Subtitle
  const subtitle = document.createElement('div');
  subtitle.textContent = `Try again! You’ll earn ${point>0?point:''} points when you get it 100% correct.`;
  Object.assign(subtitle.style, {
    fontSize: '16px',
    color: '#ffffff',
    marginBottom: '15px',
    lineHeight: '1.5',
    textAlign: 'center'
  });

  // Close button
  const closeBtn = document.createElement('div');
  closeBtn.innerHTML = '&times;';
  Object.assign(closeBtn.style, {
    position: 'absolute',
    top: '0px',
    right: '7px',
    fontSize: '26px',
    color: '#ff6666',
    cursor: 'pointer',

  });
  closeBtn.onclick = () => overlay.remove();

  // Assemble
  popup.appendChild(closeBtn);
  popup.appendChild(mascot);
  popup.appendChild(title);
  popup.appendChild(messageOutput);
  popup.appendChild(subtitle);
  overlay.appendChild(popup);
  document.body.appendChild(overlay);

  // Styles & animations
  const style = document.createElement('style');
  style.innerHTML = `
    @keyframes shake {
      0% { transform: rotate(0); }
      25% { transform: rotate(-10deg); }
      50% { transform: rotate(10deg); }
      75% { transform: rotate(-5deg); }
      100% { transform: rotate(0); }
    }

    @keyframes slideBounce {
      0% { transform: translateY(-80px); opacity: 0; }
      70% { transform: translateY(10px); opacity: 1; }
      100% { transform: translateY(0); }
    }

    @media (max-width: 768px) {
      .try-again-popup {
        width: 90% !important;
        padding: 20px 15px !important;
      }
    }

    @media (max-width: 480px) {
      .try-again-popup {
        width: 95% !important;
        font-size: 16px !important;
      }
    }
  `;
  document.head.appendChild(style);
}

function checkAndSetTodayRewardCookie() {
    // Get today's date in YYYY-MM-DD format
    const today = new Date().toISOString().split('T')[0];

    // Function to get cookie value by name
    function getCookie(name) {
        const match = document.cookie.match(new RegExp('(^| )' + name + '=([^;]+)'));
        return match ? match[2] : null;
    }

    // Check if cookie exists and matches today's date
    const cookieValue = getCookie("today_reward");
    if (cookieValue === today) {
        console.log("Today's reward already claimed.");
        return true; // Already present
    }

    jQuery.ajax({
      type: 'POST',
      dataType : 'json',
      data:{
        curr_user_login_token:curr_user_login_token
      },
      url: `https://www.eslfast.com/membership/api/get-user-yesterday-reward/`
    }).done(function (res) {
        if(res.status=="success"){
            // Set the cookie with today's date (expires in 1 day)
            document.cookie = `today_reward=${today}; path=/; expires=${new Date(Date.now() + 86400000).toUTCString()}`;
            console.log("Today's reward set.");
            let total_point = res.total_point;
            let fnl_txt = "<span style='font-size: 30px;'>"+res.point+"</span><br>Your total score so far: <span style='font-size: 22px;'>"+total_point+"</span>";
            if(res.point <= 0){
                if(total_point > 0){
                    let fnl_ptt = parseInt(total_point)-5;
                    fnl_txt = "<span style='font-size: 30px;'>"+res.point+"</span><br>Your total score so far: "+total_point+" - 5 = <span style='font-size: 22px;'>"+(fnl_ptt > 0 ? fnl_ptt : 0)+"</span><br>You must study at least 15 minutes daily to keep your points.";
                }else{
                     fnl_txt = "<span style='font-size: 30px;'>"+res.point+"</span><br>Your total score so far: <span style='font-size: 22px;'>"+total_point+"</span><br>You must study at least 15 minutes daily to keep your points.";
                }
            }
            dailyrewardpopup(fnl_txt)
            return false; // Was not present, now set
        }
    }).fail(function (jqXHR, textStatus) {

    });
}

  checkAndSetTodayRewardCookie();
  setInterval(function () {
      checkAndSetTodayRewardCookie();
  }, 600000);

function dailyrewardpopup(txt_msg) {
  // Try to play audio
  // const audio = new Audio('https://www.eslfast.com/js/sound/sound1.mp3');
  // audio.play().catch(err => {
  //   console.warn('Audio permission denied:', err.message);
  // });

  // Random praise phrase
  const phrases = ["Great Job!", "Well Done!", "Awesome!", "Amazing!", "Excellent!", "Great!"];
  const randomPhrase = phrases[Math.floor(Math.random() * phrases.length)];

  // Create overlay
  const overlay = document.createElement('div');
  Object.assign(overlay.style, {
    position: 'fixed',
    top: 0,
    left: 0,
    width: '100vw',
    height: '100vh',
    backgroundColor: 'rgba(0,0,0,0.5)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 9999,
    padding: '20px',
  });

  // Create popup
  const popup = document.createElement('div');
  popup.className = 'lesson-complete-popup';
  Object.assign(popup.style, {
    background: 'linear-gradient(135deg, #fff8dc, #e0ffe0)',
    borderRadius: '20px',
    padding: '30px 20px',
    boxShadow: '0 0 30px rgba(0,0,0,0.3)',
    textAlign: 'center',
    position: 'relative',
    animation: 'bounceIn 0.8s ease-out, glowPulse 3s infinite alternate',
    maxWidth: '90%',
    width: '400px',
    fontFamily: 'Segoe UI, sans-serif',
    color: '#1a1a1a',
    overflow: 'hidden',
  });

  // Character Image
  const character = document.createElement('img');
  character.src = 'https://www.eslfast.com/js/img/susan3.jpg';
  Object.assign(character.style, {
    width: '100px',
    borderRadius: '50%',
    animation: 'floatSwing 3s ease-in-out infinite',
    marginBottom: '15px',
    display: 'block',
    marginLeft: 'auto',
    marginRight: 'auto'
  });

  // Heading
  const heading = document.createElement('h2');
  heading.innerText = 'Yesterday Time Spent Reward';
  Object.assign(heading.style, {
    marginBottom: '15px',
    fontSize: '28px',
    color: '#006400',
    textAlign: 'center',
  });

  // Subtext
  const subtext = document.createElement('p');
  subtext.innerHTML = `<div style="text-align:center;"><b>${txt_msg}</b></div>`;
  Object.assign(subtext.style, {
    fontSize: '18px',
    color: '#333',
    marginBottom: '20px',
    textAlign: 'center',
  });

  // Close button
  const closeBtn = document.createElement('div');
  closeBtn.innerHTML = '&times;';
  Object.assign(closeBtn.style, {
    position: 'absolute',
    top: '0px',
    right: '7px',
    fontSize: '26px',
    color: '#666',
    cursor: 'pointer',
    border: '1px dotted',
    padding: '0px 8px 0px 8px'
  });
  closeBtn.onclick = () => overlay.remove();

  // Append elements
  popup.appendChild(closeBtn);
  popup.appendChild(character);
  popup.appendChild(heading);
  popup.appendChild(subtext);
  overlay.appendChild(popup);
  document.body.appendChild(overlay);

  // Confetti animation
  for (let i = 0; i < 50; i++) {
    const confetti = document.createElement('div');
    Object.assign(confetti.style, {
      position: 'fixed',
      top: '50%',
      left: '50%',
      width: '8px',
      height: '8px',
      backgroundColor: `hsl(${Math.random()*360}, 100%, 50%)`,
      borderRadius: '50%',
      transform: `translate(-50%, -50%)`,
      animation: `confettiFly ${1 + Math.random()*1.5}s ease-out forwards`,
      zIndex: 10000
    });
    confetti.style.setProperty('--x', `${(Math.random() - 0.5) * 400}px`);
    confetti.style.setProperty('--y', `${(Math.random() - 0.5) * 400}px`);
    document.body.appendChild(confetti);
    setTimeout(() => confetti.remove(), 3000);
  }

  // Style animations
  const style = document.createElement('style');
  style.textContent = `
    @keyframes bounceIn {
      0% { transform: scale(0.7); opacity: 0; }
      80% { transform: scale(1.1); opacity: 1; }
      100% { transform: scale(1); }
    }
    @keyframes floatSwing {
      0%, 100% { transform: translateY(0) rotate(0deg); }
      50% { transform: translateY(-10px) rotate(3deg); }
    }
    @keyframes glowPulse {
      0% { box-shadow: 0 0 10px #aaffaa; }
      100% { box-shadow: 0 0 30px #55ff55; }
    }
    @keyframes confettiFly {
      to {
        transform: translate(calc(-50% + var(--x)), calc(-50% + var(--y))) rotate(720deg);
        opacity: 0;
      }
    }

    /* Responsive */
    @media (max-width: 768px) {
      .lesson-complete-popup {
        width: 90% !important;
        padding: 20px 15px !important;
      }
    }

    @media (max-width: 480px) {
      .lesson-complete-popup {
        width: 95% !important;
        font-size: 16px !important;
      }
    }
  `;
  document.head.appendChild(style);
}

function showInvalidLoginPopup(Output_txt = '') {
  // Create overlay
  const overlay = document.createElement('div');
  Object.assign(overlay.style, {
    position: 'fixed',
    top: '0',
    left: '0',
    width: '100vw',
    height: '100vh',
    backgroundColor: 'rgba(0,0,0,0.6)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: '9999',
    padding: '20px'
  });

  // Create popup
  const popup = document.createElement('div');
  popup.className = 'try-again-popup';
  Object.assign(popup.style, {
    background: 'linear-gradient(135deg, #400202, #300000)',
    borderRadius: '20px',
    padding: '30px 20px',
    boxShadow: '0 0 25px rgba(0,0,0,0.4)',
    maxWidth: '90%',
    width: '400px',
    color: '#ffffff',
    textAlign: 'center',
    fontFamily: 'Segoe UI, sans-serif',
    animation: 'slideBounce 0.8s ease-out',
    position: 'relative'
  });

  // Animated Mascot Image
  const mascot = document.createElement('div');
  mascot.innerHTML = `<img src="https://www.eslfast.com/js/img/susan3.jpg" style="width: 80px;">`;
  Object.assign(mascot.style, {
    animation: 'shake 1s infinite',
    marginBottom: '15px',
    textAlign: 'center'
  });

  // Dynamic output
  const messageOutput = document.createElement('div');
  messageOutput.innerHTML = Output_txt;
  Object.assign(messageOutput.style, {
    fontSize: '16px',
    color: '#ffffff',
    marginBottom: '10px',
    lineHeight: '1.5',
    textAlign: 'center'
  });

  // Close button
  const closeBtn = document.createElement('div');
  closeBtn.innerHTML = '&times;';
  Object.assign(closeBtn.style, {
    position: 'absolute',
    top: '0px',
    right: '7px',
    fontSize: '26px',
    color: '#ff6666',
    cursor: 'pointer',

  });
  closeBtn.onclick = () => overlay.remove();

  // Assemble
  popup.appendChild(closeBtn);
  popup.appendChild(mascot);
  popup.appendChild(messageOutput);
  overlay.appendChild(popup);
  document.body.appendChild(overlay);

  // Styles & animations
  const style = document.createElement('style');
  style.innerHTML = `
    @keyframes shake {
      0% { transform: rotate(0); }
      25% { transform: rotate(-10deg); }
      50% { transform: rotate(10deg); }
      75% { transform: rotate(-5deg); }
      100% { transform: rotate(0); }
    }

    @keyframes slideBounce {
      0% { transform: translateY(-80px); opacity: 0; }
      70% { transform: translateY(10px); opacity: 1; }
      100% { transform: translateY(0); }
    }

    @media (max-width: 768px) {
      .try-again-popup {
        width: 90% !important;
        padding: 20px 15px !important;
      }
    }

    @media (max-width: 480px) {
      .try-again-popup {
        width: 95% !important;
        font-size: 16px !important;
      }
    }
  `;
  document.head.appendChild(style);
}

function showTierPromotionPopup(newTier, rewardPoints = 0) {
  // Play celebration sound
//  const audio = new Audio('https://www.eslfast.com/js/sound/sound1.mp3');
//  audio.play().catch(err => console.warn('Audio blocked:', err.message));

  // Tier color themes
  const tierColors = {
    Bronze: '#cd7f32',
    Silver: '#c0c0c0',
    Gold: '#ffd700'
  };

  // Get new tier color
  const newTierColor = tierColors[newTier] || '#88e188';

  // Random congratulatory phrases
  const phrases = [
    "You're moving up!",
    "Fantastic Progress!",
    "Promotion Unlocked!",
    "Keep Shining!",
    "Level Up!",
    "Well Deserved!"
  ];
  const randomPhrase = phrases[Math.floor(Math.random() * phrases.length)];

  // Create overlay
  const overlay = document.createElement('div');
  Object.assign(overlay.style, {
    position: 'fixed',
    top: 0,
    left: 0,
    width: '100vw',
    height: '100vh',
    backgroundColor: 'rgba(0,0,0,0.5)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 9999,
    padding: '20px',
  });

  // Create popup
  const popup = document.createElement('div');
  popup.className = 'tier-promotion-popup';
  Object.assign(popup.style, {
    background: `linear-gradient(135deg, #ffffff, ${newTierColor}33)`,
    borderRadius: '20px',
    padding: '35px 25px',
    boxShadow: `0 0 25px ${newTierColor}`,
    textAlign: 'center',
    position: 'relative',
    animation: 'bounceIn 0.8s ease-out, tierGlow 2.5s infinite alternate',
    maxWidth: '90%',
    width: '420px',
    fontFamily: 'Segoe UI, sans-serif',
    color: '#1a1a1a',
    overflow: 'hidden',
  });

  // Medal / Tier Image
  const tierIcon = document.createElement('img');
  tierIcon.src = 'https://www.eslfast.com/js/img/Medal_Tier_'+newTier+'.png'; // trophy icon
  Object.assign(tierIcon.style, {
    width: '90px',
    display: 'block',
    margin: '0 auto 15px auto',
    animation: 'floatSwing 3s ease-in-out infinite'
  });

  // Heading
  const heading = document.createElement('h2');
  heading.innerText = '🏆 Tier Promotion!';
  Object.assign(heading.style, {
    fontSize: '28px',
    color: newTierColor,
    marginBottom: '10px'
  });

  // Random phrase
  const praise = document.createElement('p');
  praise.innerText = randomPhrase;
  Object.assign(praise.style, {
    fontSize: '22px',
    color: '#333',
    fontWeight: 'bold',
    marginBottom: '15px',
  });

  // Tier details
  const tierDetails = document.createElement('div');
  tierDetails.innerHTML = `
    <p style="font-size: 18px; margin-bottom: 15px;">

    </p>
    ${rewardPoints > 0 ? `<p style="font-size:17px; color:#222;">Bonus Reward: <strong>⚡${rewardPoints} Points!</strong></p>` : ''}
  `;

  // Close button
  const closeBtn = document.createElement('div');
  closeBtn.innerHTML = '&times;';
  Object.assign(closeBtn.style, {
    position: 'absolute',
    top: '0px',
    right: '7px',
    fontSize: '26px',
    color: '#555',
    cursor: 'pointer',
    border: '1px dotted',
    padding: '0px 8px 0px 8px'
  });
  closeBtn.onclick = () => overlay.remove();

  // Append all
  popup.appendChild(closeBtn);
  popup.appendChild(tierIcon);
  popup.appendChild(heading);
  popup.appendChild(praise);
  popup.appendChild(tierDetails);
  overlay.appendChild(popup);
  document.body.appendChild(overlay);

  // Confetti burst
  for (let i = 0; i < 60; i++) {
    const confetti = document.createElement('div');
    Object.assign(confetti.style, {
      position: 'fixed',
      top: '50%',
      left: '50%',
      width: '8px',
      height: '8px',
      backgroundColor: `hsl(${Math.random() * 360}, 100%, 50%)`,
      borderRadius: '50%',
      transform: `translate(-50%, -50%)`,
      animation: `confettiFly ${1 + Math.random() * 1.5}s ease-out forwards`,
      zIndex: 10000
    });
    confetti.style.setProperty('--x', `${(Math.random() - 0.5) * 400}px`);
    confetti.style.setProperty('--y', `${(Math.random() - 0.5) * 400}px`);
    document.body.appendChild(confetti);
    setTimeout(() => confetti.remove(), 3000);
  }

  // Animations
  const style = document.createElement('style');
  style.textContent = `
    @keyframes bounceIn {
      0% { transform: scale(0.7); opacity: 0; }
      80% { transform: scale(1.1); opacity: 1; }
      100% { transform: scale(1); }
    }
    @keyframes floatSwing {
      0%, 100% { transform: translateY(0) rotate(0deg); }
      50% { transform: translateY(-10px) rotate(3deg); }
    }
    @keyframes tierGlow {
      0% { box-shadow: 0 0 15px ${newTierColor}55; }
      100% { box-shadow: 0 0 35px ${newTierColor}; }
    }
    @keyframes confettiFly {
      to {
        transform: translate(calc(-50% + var(--x)), calc(-50% + var(--y))) rotate(720deg);
        opacity: 0;
      }
    }

    @media (max-width: 768px) {
      .tier-promotion-popup {
        width: 90% !important;
        padding: 20px 15px !important;
      }
    }
    @media (max-width: 480px) {
      .tier-promotion-popup {
        width: 95% !important;
        font-size: 16px !important;
      }
    }
  `;
  document.head.appendChild(style);
}

$('.chat a.chat-icon').click(function(){
  jQuery.ajax({
    type: 'POST',
    dataType : 'json',
    url: `https://www.eslfast.com/membership/api/valid-token/${curr_user_login_token}`
    }).done(function (res) {

        if ((res.token_key != '')) {
          window.location.href = `https://www.eslfast.com/membership/talk-to-tutor`;
        }else{
          window.location.href = `https://www.eslfast.com/Chatbot_Tutor/notice.htm`;
          // alert('Your login session has expired. Please log in again to access the chat feature.');
        }
    }).fail(function (jqXHR, textStatus) {

    });
  return false;
});

console.log(curr_page_url);
console.log(curr_content_id);
console.log(curr_user_login_token);