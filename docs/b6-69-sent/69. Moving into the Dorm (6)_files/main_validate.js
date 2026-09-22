$(document).ready(function () {
    let searchParams = new URLSearchParams(window.location.search);
    if (searchParams.has('token')) {
        let tkn = searchParams.get('token');
        setCookie('login_token', tkn, 365);
    }
    checkCookie();
    //                    $('#exampleModalCenter').modal('show');
});

$('#ajax_forgot_password').validate({
    submitHandler: function (form) {
        jQuery.ajax({
            type: 'POST',
            data: {email: $('#forg_email').val()},
            dataType: 'json',

            url: 'https://www.eslfast.com/membership/api/checkEmail',
        }).done(function (res) {
            $('.full_loading').hide();
            if (res.status == 'error') {
                alert('Email not found');
                $('#forg_email').val('');
                return false;
            }
            if (res.status == 'success') {
                form.submit();
                return true;
            }

        }).fail(function () {
            alert('Error found. Try again..');
            return false;
        });

        return false;
    },

    rules: {
        email: {
            required: true,
            email: true
        }
    },
    messages: {
        email: {
            required: "Enter your login email."
        }
    },
    errorElement: 'div',
    errorClass: 'error text-danger'
});

$('#login_frm').validate({
    submitHandler: function (form) {
        jQuery.ajax({
            type: 'POST',
            data: $('#login_frm').serialize(),
            dataType: 'json',
            //                            beforeSend: function (xhr) {
            //                                xhr.setRequestHeader('X-CSRF-Token',<?= json_encode($this->request->getParam('_csrfToken')); ?>);
            //                            },
            url: 'https://www.eslfast.com/membership/api/ajaxLogin',
        }).done(function (res) {
            if (res.status == 'error') {
                $('#up_msg_div').html('<div class="alert alert-danger alert-dismissible fade show" role="alert"><strong>' + res.msg + '</strong> .<button type="button" class="close" data-dismiss="alert" aria-label="Close"><span aria-hidden="true">&times;</span></button></div>');
            }
            if (res.status == 'success') {
                $('#up_msg_div').html('<div class="alert alert-success alert-dismissible fade show" role="alert"><strong>' + res.msg + '</strong> .<button type="button" class="close" data-dismiss="alert" aria-label="Close"><span aria-hidden="true">&times;</span></button></div>');

            }

            if (res.login_token != '') {
                setCookie('login_token', res.login_token, 365);
                location.reload();

            }
            return false;
        }).fail(function () {
            alert('Error found. Try again..');
            return false;
        });

        return false;
    },
    rules: {
        email: {
            required: true,
            email: true
        },
        password: {
            required: true
        }
    },
    errorElement: 'div',
    errorClass: 'error text-danger text-left',
});

function getCookie(cname) {
    var name = cname + "=";
    var decodedCookie = decodeURIComponent(document.cookie);
    var ca = decodedCookie.split(';');
    for (var i = 0; i < ca.length; i++) {
        var c = ca[i];
        while (c.charAt(0) == ' ') {
            c = c.substring(1);
        }
        if (c.indexOf(name) == 0) {
            return c.substring(name.length, c.length);
        }
    }
    return "";
}

function setCookie(cname, cvalue, exdays) {
    var d = new Date();
    d.setTime(d.getTime() + (exdays * 24 * 60 * 60 * 1000));
    var expires = "expires=" + d.toUTCString();
    document.cookie = cname + "=" + cvalue + ";" + expires + ";path=/";
}

function checkCookie() {
    var login_token = getCookie("login_token");
    if (login_token != "") {
        //                   // alert("token " + login_token);
        jQuery.ajax({
            type: 'POST',
            data: $('#login_frm').serialize(),
            dataType: 'json',
            url: 'https://www.eslfast.com/membership/api/valid-token/' + login_token,
        }).done(function (res) {
            // if ((res.token_key != '') && (res.memb_status == 1)) {
            if ((res.token_key != '')) {
                setCookie('login_token', res.token_key, 365);
                $('.after_login').show();
                $('.before_login').hide();
                $('a').each(function () {
                    let current_url = $(this).attr('href');
                    let new_url = current_url.replace("TOKEN_KEY", res.token_key);

                    $(this).removeAttr('href');
                    $(this).attr('href', new_url);
                });
                if ((res.memb_status == 1)) {
                    $('div[class^="ads-"]').remove();
                    setTimeout(function () {
                        $('.google-auto-placed').hide();
                        $('.google-auto-placed').remove();
                        $('.adsbygoogle').remove();
                        $('.google-anno-skip').remove();
                        $('audio, video').removeAttr('controlsList', "nodownload");
                    }, 1000);
                }
            } else {
                $('.after_login').hide();
                $('.before_login').show();
            }
            return false;
        }).fail(function () {
        });

    } else {
        //                     alert("no token ");
        $('.after_login').hide();
        $('.before_login').show();
    }
}

function userLogout() {
    setCookie('login_token', '', 365);
    window.location.href = "https://www.eslfast.com/membership/logout";
}