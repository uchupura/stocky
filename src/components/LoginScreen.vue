<script setup>
import { computed } from 'vue'

const props = defineProps({
  loginUrl: { type: String, required: true },
  errorCode: { type: String, default: '' }, // 서버가 ?login_error= 로 알려준 실패 이유
})

const MESSAGES = {
  forbidden: '접근 권한이 없는 계정이에요. 허용된 네이버 계정으로 로그인해 주세요.',
  no_email: '네이버 로그인 화면에서 연락처 이메일 제공에 동의해 주세요.',
  cancelled: '로그인을 취소했어요.',
  state: '로그인 요청이 만료됐어요. 다시 시도해 주세요.',
  token: '네이버 인증에 실패했어요. 잠시 후 다시 시도해 주세요.',
  profile: '네이버 프로필을 가져오지 못했어요. 다시 시도해 주세요.',
  server: '로그인 처리 중 오류가 났어요. 잠시 후 다시 시도해 주세요.',
}
const message = computed(() => (props.errorCode ? MESSAGES[props.errorCode] || MESSAGES.server : ''))
</script>

<template>
  <main class="login">
    <div class="login-card">
      <div class="brand login-brand">Stocky<span>.</span></div>
      <h1>내 투자를 보려면<br>로그인해 주세요</h1>
      <p class="login-sub">허용된 계정만 포트폴리오를 볼 수 있어요</p>

      <p v-if="message" class="form-error" role="alert">{{ message }}</p>

      <a class="naver-btn" :href="loginUrl">
        <span class="naver-mark" aria-hidden="true">N</span>
        네이버로 로그인
      </a>
    </div>
  </main>
</template>
