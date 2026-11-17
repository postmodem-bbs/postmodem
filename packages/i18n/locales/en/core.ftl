# SPDX-License-Identifier: AGPL-3.0-or-later

skip-to-content = Skip to content
nav-label = Main navigation
nav-index = Board index
nav-search = Search
nav-members = Members

welcome-title = Welcome to { $board }
welcome-body = This board is brand new. Forums, topics and posts arrive in the next milestone.

posts-count = { $count ->
    [one] { $count } post
   *[other] { $count } posts
}

footer-powered = Powered by { $product } { $version }
footer-source = Source code
footer-licence = Licensed under the GNU AGPL v3
language-label = Language
theme-label = Theme
theme-light = Light
theme-dark = Dark
theme-system = System

bb-you-guest = guest
bb-hidden-content = This content is hidden.

guest = Guest
by-author = by { $name }
breadcrumb-label = You are here
board-empty = This board has no forums yet. Run “postmodem seed-demo” to fill it with demo content.

index-forum = Forum
index-topics = Topics
index-posts = Posts
index-last-post = Last post
index-no-posts = No posts
index-restricted = Restricted: you cannot read this forum
index-subforums = Sub-forums
index-locked = (locked)

topics-count = { $count ->
    [one] { $count } topic
   *[other] { $count } topics
}
users-count = { $count ->
    [one] { $count } registered user
   *[other] { $count } registered users
}
stats-heading = Statistics
stats-totals = Our users have written { $posts } in { $topics }. We have { $users }.
stats-newest = Newest member: { $name }

forum-topic = Topic
forum-author = Author
forum-replies = Replies
forum-views = Views
forum-no-topics = There are no topics in this forum yet.
forum-category-hint = Choose a forum:

topic-announcement = Announcement
topic-sticky = Sticky
topic-locked = Locked
topic-moved = Moved

pagination-label = Pages
pagination-status = Page { $current } of { $total }
pagination-prev = Previous
pagination-next = Next
pagination-goto = Page { $n }

post-permalink = Link to this post
post-author-posts = Posts: { $count }
post-author-joined = Joined
post-author-from = From
post-guest = guest

## Error pages
error-404-title = Page not found
error-404-body = This forum, topic or post does not exist, or you are not allowed to see it.
error-403-title = Access denied
error-403-body = You can see this forum exists, but you are not allowed to read it. Signing in may help.
error-other-title = Something went wrong
error-other-body = The board could not show this page. Please try again in a moment.
error-back = Back to the board index

## Accounts
signed-in-as = Signed in as { $name }
login-link = Sign in
register-link = Register
logout = Sign out
logout-everywhere = Sign out on all devices
logout-everywhere-hint = { $count ->
    [0] You are not signed in anywhere else.
    [one] You are also signed in on one other device.
   *[other] You are also signed in on { $count } other devices.
}
login-title = Sign in
login-signed-in-as = You are signed in as { $name }.
login-name = Username or e-mail address
login-password = Password
login-submit = Sign in
login-no-account = No account yet?
login-error-invalid = That username or password is not right.
login-error-inactive = This account can’t sign in right now. Contact the board’s administrators if you think that’s a mistake.
login-error-throttled = Too many attempts. Please wait { $seconds ->
    [one] one second
   *[other] { $seconds } seconds
} and try again.
register-title = Register
register-username = Username
register-username-hint = 2 to 25 letters or digits; spaces, dots, hyphens and underscores between them are fine.
register-email = E-mail address
register-email-hint = Used to sign in and to reset your password. Never shown to other users.
register-password = Password
register-password-hint = At least 10 characters. A few unrelated words make a strong password.
register-rules = Board rules
register-accept-rules = I have read and accept the board rules
register-submit = Create account
register-have-account = Already registered?
register-error-throttled = Too many registrations from your network. Please try again in { $minutes ->
    [one] a minute
   *[other] { $minutes } minutes
}.
register-welcome = Welcome aboard, { $name }! You are signed in.
form-has-errors = Please correct the fields marked below.
username-error-too-short = The username is too short.
username-error-too-long = The username is too long (at most 25 characters).
username-error-characters = Use letters, digits, spaces, dots, hyphens and underscores only.
username-error-edges = Spaces, dots, hyphens and underscores can only go between letters or digits, one at a time.
username-error-mixed-scripts = Please use one alphabet: mixing, say, Latin and Cyrillic letters isn’t allowed.
username-error-disallowed = This username is reserved.
username-error-taken = This username, or one that looks just like it, is already taken.
email-error-invalid = This doesn’t look like an e-mail address.
email-error-taken = An account with this e-mail address already exists.
password-error-too-short = The password must be at least 10 characters long.
password-error-too-long = The password is too long.
password-error-same-as-name = The password can’t be your username or e-mail address.
rules-error-required = You need to accept the rules to register.
rules-default =
    Be kind. Disagree with ideas, not with people.

    No spam, advertising or illegal content. Posts that break the rules may be edited or removed by moderators.

    Write in a way others can read: a descriptive topic title helps everyone.

## E-mail verification and password reset
mail-verify-subject = Confirm your e-mail address for { $board }
mail-verify-body =
    Hello { $name },

    someone (hopefully you) registered the account “{ $name }” on { $board } with this e-mail address. To finish, open this link:

    { $link }

    The link works once and for 7 days. If this wasn’t you, ignore this message and the account won’t be activated.
mail-reset-subject = Reset your password on { $board }
mail-reset-body =
    Hello { $name },

    someone (hopefully you) asked to reset the password of the account “{ $name }” on { $board }. To choose a new password, open this link:

    { $link }

    The link works once and for one hour. If this wasn’t you, ignore this message: your password stays as it is.
verify-title = Confirm your e-mail address
verify-sent = Almost there! We’ve sent a link to your e-mail address. Open it to activate your account. It may take a minute to arrive; check your spam folder too.
verify-confirm-text = Confirm the e-mail address of the account “{ $name }” and sign in.
verify-confirm-submit = Confirm and sign in
verify-invalid = This link has expired or has already been used. Sign in to get a new one.
verified-notice = Thanks, { $name }! Your e-mail address is confirmed and you are signed in.
login-error-unverified = Your e-mail address isn’t confirmed yet. Open the link we sent you, or get a new one.
login-resend = Send a new link
login-resent = If that account is waiting for confirmation, we’ve sent a new link to its e-mail address.
login-forgot = Forgot your password?
reset-title = Reset your password
reset-request-text = Enter the e-mail address of your account and we’ll send you a link to choose a new password.
reset-request-submit = Send the link
reset-requested = If an account uses that address, we’ve sent it a link. It works for one hour.
reset-error-throttled = Too many requests from your network. Please try again later.
reset-new-text = Choose a new password for “{ $name }”. You will be signed out everywhere else.
reset-new-password = New password
reset-submit = Save and sign in
reset-invalid = This link has expired or has already been used. You can ask for a new one below.
reset-done-notice = Your password has been changed and you are signed in. Other devices have been signed out.
