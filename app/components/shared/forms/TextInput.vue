<template>
<div class="input-container">
  <div class="input-label">
    <label>{{ value.description }}</label>
  </div>
  <div class="input-wrapper" v-if="value.multiline">
    <textarea
      rows="4"
      :value="value.value"
      :disabled="value.enabled == false"
      @change="onInputHandler"/>
  </div>
  <div class="input-wrapper" v-else>
    <input
      :type="textVisible ? 'text' : 'password'"
      :value="value.value"
      :disabled="value.enabled == false"
      @change="onInputHandler"
    />
    <button
      class="button button--default button--input"
      v-if="value.masked"
      @click="toggleVisible">
      {{ textVisible ? 'Hide' : 'Show' }}
    </button>
    <slot></slot>
  </div>
</div>
</template>

<script lang="ts" src="./TextInput.vue.ts"></script>

<style lang="less" scoped>
.input-wrapper {
  display: flex;
}

.button--input {
  flex: 0 0 auto;
  width: 80px;
  margin-left: 12px;
}
</style>
