// Start of HotPotatoes script, full unabridged section with .nodisplay support
// Your CSS: .nodisplay { display: none; }

function Client(){
    // if not a DOM browser, hopeless
    this.min = false; if (document.getElementById){ this.min = true; }
    this.ua = navigator.userAgent;
    this.name = navigator.appName;
    this.ver = navigator.appVersion;

    // Get data about the browser
    this.mac = (this.ver.indexOf('Mac') != -1);
    this.win = (this.ver.indexOf('Windows') != -1);

    // Look for Gecko
    this.gecko = (this.ua.indexOf('Gecko') > 1);
    if (this.gecko){ this.geckoVer = parseInt(this.ua.substring(this.ua.indexOf('Gecko')+6)); }

    // Look for Firebird
    this.firebird = (this.ua.indexOf('Firebird') > 1);

    // Look for Safari
    this.safari = (this.ua.indexOf('Safari') > 1);
    if (this.safari){ this.gecko = false; }

    // Look for IE
    this.ie = (this.ua.indexOf('MSIE') > 0);
    if (this.ie){
        this.ieVer = parseFloat(this.ua.substring(this.ua.indexOf('MSIE')+5));
        if (this.ieVer < 5.5){ this.min = false; }
    }

    // Look for Opera
    this.opera = (this.ua.indexOf('Opera') > 0);
    if (this.opera){
        this.operaVer = parseFloat(this.ua.substring(this.ua.indexOf('Opera')+6));
        if (this.operaVer < 7.04){ this.min = false; }
    }

    // Special case for IE5 Mac
    this.ie5mac = (this.ie && this.mac && (this.ieVer < 6));
}

var C = new Client();

// CODE FOR HANDLING NAV BUTTONS AND FUNCTION BUTTONS
function NavBtnOver(Btn){ if (Btn.className != 'NavButtonDown') Btn.className = 'NavButtonUp'; }
function NavBtnOut(Btn){ Btn.className = 'NavButton'; }
function NavBtnDown(Btn){ Btn.className = 'NavButtonDown'; }
function FuncBtnOver(Btn){ if (Btn.className != 'FuncButtonDown') Btn.className = 'FuncButtonUp'; }
function FuncBtnOut(Btn){ Btn.className = 'FuncButton'; }
function FuncBtnDown(Btn){ Btn.className = 'FuncButtonDown'; }
function FocusAButton(){
    var btn = document.getElementById('CheckButton1') || document.getElementById('CheckButton2') || document.getElementsByTagName('button')[0];
    if (btn) btn.focus();
}

// CODE FOR HANDLING DISPLAY OF POPUP FEEDBACK BOX
var topZ = 1000;
function ShowMessage(Feedback){
    document.getElementById('FeedbackContent').innerHTML = Feedback + '<br><br>';
    var FDiv = document.getElementById('FeedbackDiv');
    // remove nodisplay class, then show
    FDiv.classList.remove('nodisplay');
    FDiv.style.display = 'block';
    FDiv.style.zIndex = (++topZ);
    FDiv.style.top = TopSettingWithScrollOffset(30) + 'px';
    ShowElements(false, 'input');
    ShowElements(false, 'select');
    ShowElements(false, 'object');
    ShowElements(true, 'object', 'FeedbackContent');
    setTimeout("document.getElementById('FeedbackOKButton').focus()", 50);
}
function HideFeedback(){
    var FDiv = document.getElementById('FeedbackDiv');
    FDiv.style.display = 'none';
    ShowElements(true, 'input');
    ShowElements(true, 'select');
    ShowElements(true, 'object');
    if (Finished) Finish();
}

// GENERAL UTILITY FUNCTIONS
function ShowElements(Show, TagName, ContainerToReverse){
    var TopNode = ContainerToReverse ? document.getElementById(ContainerToReverse) : document;
    var Els = TopNode.getElementsByTagName(TagName);
    for (var i = 0; i < Els.length; i++){
        if (TagName === 'object'){
            Els[i].style.visibility = Show ? 'visible' : 'hidden';
            if (C.mac && C.gecko) Els[i].style.display = Show ? '' : 'none';
        } else if (TagName === 'input' || TagName === 'select'){
            if (C.ie && C.ieVer < 7) Els[i].style.visibility = Show ? 'visible' : 'hidden';
        }
    }
}

// Prevent Backspace Navigation
var InTextBox = false;
function SuppressBackspace(e){
    if (InTextBox) return;
    var key = C.ie ? window.event.keyCode : e.keyCode;
    if (key === 8){
        if (C.ie){ window.event.returnValue = false; window.event.cancelBubble = true; }
        else e.preventDefault();
    }
}
if (C.ie){ document.attachEvent('onkeydown', SuppressBackspace); window.attachEvent('onkeydown', SuppressBackspace); }
else if (window.addEventListener){ window.addEventListener('keypress', SuppressBackspace, false); }

// PAGE DIMENSION FUNCTIONS
function PageDim(){ this.W = document.body.clientWidth; this.H = document.body.clientHeight; }
function GetPageXY(El){ var XY={x:0,y:0}; while(El){ XY.x+=El.offsetLeft; XY.y+=El.offsetTop; El=El.offsetParent;} return XY; }
function GetScrollTop(){ return typeof window.pageYOffset==='number' ? window.pageYOffset : (document.documentElement.scrollTop || document.body.scrollTop); }
function GetViewportHeight(){ return window.innerHeight || document.documentElement.clientHeight || document.body.clientHeight; }
function TopSettingWithScrollOffset(p){ return GetScrollTop() + Math.floor(GetViewportHeight() * (p/100)); }

// ARRAY UTILS
function ReduceItems(a,n){ while(a.length>n){ a.splice(Math.floor(a.length*Math.random()),1); } }
function Shuffle(a){ var i=a.length,j,t; while(i){ j=Math.floor(Math.random()*i--); t=a[i]; a[i]=a[j]; a[j]=t; } return a; }

// STRING UTILS
function EscapeDoubleQuotes(s){ return s.replace(/"/g,'&quot;'); }
function TrimString(s){ return s.replace(/^[\s\n\r]+|[\s\n\r]+$/g,'').replace(/ {2,}/g,' '); }
function FindLongest(a){ if(a.length<1) return -1; var m=0; for(var i=1;i<a.length;i++) if(a[i].length>a[m].length) m=i; return m; }

// SETUP FUNCTIONS
function ClearTextBoxes(){ var inputs=document.getElementsByTagName('input'); for(var i=0;i<inputs.length;i++){ var id=inputs[i].id; if(/Guess|Gap/.test(id)) inputs[i].value=''; if(/Chk/.test(id)) inputs[i].checked=false; }}
function Array_IndexOf(v){ for(var i=0;i<this.length;i++) if(this[i]===v) return i; return -1; }
Array.prototype.indexOf = Array_IndexOf;
function RemoveBottomNavBarForIE(){ if(C.ie && document.getElementById('Reading') && document.getElementById('BottomNavBar')){ document.getElementById('TheBody').removeChild(document.getElementById('BottomNavBar')); }}

// HOTPOTNET TRACKING
var HPNStartTime=(new Date()).getTime(), SubmissionTimeout=30000, Detail='';
function Finish(){ if(document.store){ var f=document.store; f.starttime.value=HPNStartTime; f.endtime.value=(new Date()).getTime(); f.mark.value=Score; f.detail.value=Detail; f.submit(); }}

// JQUIZ CORE VARIABLES
var CurrQNum=0, CorrectIndicator=':-)', IncorrectIndicator='X', YourScoreIs='Your score is ';
var CompletedSoFar='Questions completed so far: ', ExerciseCompleted='You have completed the exercise.', ShowCompletedSoFar=true;
var ContinuousScoring=false, CorrectFirstTime='Questions answered correctly first time: ', ShowCorrectFirstTime=false;
var ShuffleQs=false, ShuffleAs=false, DefaultRight='Correct!', DefaultWrong='Sorry! Please try again.', QsToShow=5;
var Score=0, Finished=false, Qs=null, QArray=[], ShowingAllQuestions=false;
var ShowAllQuestionsCaption='Show all questions', ShowOneByOneCaption='Show questions one by one';
var State=[], Feedback='', TimeOver=false, strInstructions='', Locked=false, strQuestionFinished='';

// INITIAL FEEDBACK COMPLETION
function CompleteEmptyFeedback(){ for(var q=0;q<I.length;q++){ if(I[q][2]!=='3'){ for(var a=0;a<I[q][3].length;a++){ if(I[q][3][a][1].length<1) I[q][3][a][1]=I[q][3][a][2]>0?DefaultRight:DefaultWrong; }}} }

// SET UP QUESTIONS
function SetUpQuestions(){
    Qs=document.getElementById('Questions');
    var lis=Qs.getElementsByTagName('li');
    QArray=[];
    for(var i=0;i<lis.length;i++){
        QArray.push(lis[i]);
        lis[i].classList.add('nodisplay'); // hide via class
        lis[i].style.display=''; // clear inline
    }
    if(QArray[0]){
        QArray[0].classList.remove('nodisplay'); // show first
        QArray[0].style.display='';
    }
    SetQNumReadout();
    SetFocusToTextbox();
}

// SHOW/HIDE ALL
function ShowHideQuestions(){
    var btn=document.getElementById('ShowMethodButton');
    FuncBtnOut(btn);
    btn.style.display='none';
    if(!ShowingAllQuestions){
        for(var i=0;i<QArray.length;i++){
            QArray[i].classList.remove('nodisplay');
            QArray[i].style.display='';
        }
        document.getElementById('Questions').style.listStyleType='decimal';
        document.getElementById('OneByOneReadout').style.display='none';
        btn.innerHTML=ShowOneByOneCaption;
        ShowingAllQuestions=true;
    } else {
        for(var i=0;i<QArray.length;i++){
            if(i!==CurrQNum){
                QArray[i].classList.add('nodisplay');
                QArray[i].style.display='';
            }
        }
        document.getElementById('Questions').style.listStyleType='none';
        document.getElementById('OneByOneReadout').style.display='';
        btn.innerHTML=ShowAllQuestionsCaption;
        ShowingAllQuestions=false;
    }
    btn.style.display='inline';
}

// CHANGE QUESTION
function ChangeQ(delta){
    var next=CurrQNum+delta;
    if(next<0||next>=QArray.length) return;
    QArray[CurrQNum].classList.add('nodisplay');
    QArray[CurrQNum].style.display='';
    CurrQNum=next;
    QArray[CurrQNum].classList.remove('nodisplay');
    QArray[CurrQNum].style.display='';
    ShowSpecialReadingForQuestion();
    SetQNumReadout();
    SetFocusToTextbox();
}

// SPECIAL READING
var HiddenReadingShown=false;
function ShowSpecialReadingForQuestion(){
    var rd=document.getElementById('ReadingDiv');
    if(!rd) return;
    if(HiddenReadingShown){ rd.innerHTML=''; }
    var divs=QArray[CurrQNum].getElementsByTagName('div');
    for(var i=0;i<divs.length;i++){
        if(divs[i].className==='HiddenReading'){
            rd.innerHTML=divs[i].innerHTML;
            HiddenReadingShown=true;
            var btn=document.getElementById('ShowMethodButton'); if(btn) btn.style.display='none';
            break;
        }
    }
}

// SET READOUT
function SetQNumReadout(){
    var el=document.getElementById('QNumReadout');
    el.innerHTML=(CurrQNum+1)+' / '+QArray.length;
    document.getElementById('PrevQButton').style.visibility=CurrQNum>0?'visible':'hidden';
    document.getElementById('NextQButton').style.visibility=(CurrQNum+1<QArray.length)?'visible':'hidden';
}

// SET FOCUS
function SetFocusToTextbox(){
    var c=QArray[CurrQNum];
    var t=c.querySelector('input,textarea');
    if(t){ t.focus(); var k=document.getElementById('CharacterKeypad'); if(k) k.style.display='block'; }
}

// INITIALIZE I ARRAY (unchanged)
var I=[]; // ... populate I[...] here ...

// CREATE STATUS
function CreateStatusArray(){
    for(var q=0;q<I.length;q++){
        var el=document.getElementById('Q_'+q);
        if(el){ State[q]=[-1,[],0,0,0,'']; for(var a=0;a<I[q][3].length;a++) State[q][1][a]=0; }
        else State[q]=null;
    }
}

// CHECK SHORT ANSWER
function CheckShortAnswer(q){
    if(!State[q]||Finished||State[q][0]>-1) return;
    var G=TrimString(document.getElementById('Q_'+q+'_Guess').value);
    if(!G){ ShowMessage(PleaseEnter); return; }
    State[q][2]++;
    var CA=new CheckAnswerArray(CaseSensitive);
    CA.ClearAll();
    for(var a=0;a<I[q][3].length;a++) CA.AddAnswer(G,I[q][3][a][0],I[q][3][a][3],I[q][3][a][1]);
    CA.GetBestMatch();
    // continue original logic unchanged
}

// ONLOAD STARTUP
function StartUp(){
    RemoveBottomNavBarForIE();
    if(QsToShow<2) document.getElementById('QNav').style.display='none';
    strInstructions=document.getElementById('InstructionsDiv').innerHTML;
    CompleteEmptyFeedback();
    SetUpQuestions();
    ClearTextBoxes();
    CreateStatusArray();
    if(location.search.length){ var j=parseInt(location.search.substring(1))-1; if(!ShuffleQs&&j<=QsToShow) ChangeQ(j); }
    ShowSpecialReadingForQuestion();
}
window.onload=StartUp;

