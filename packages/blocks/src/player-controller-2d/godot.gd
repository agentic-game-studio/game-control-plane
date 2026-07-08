extends CharacterBody2D

@export var speed: float = 200.0

func _physics_process(_delta: float) -> void:
	var velocity_input = Vector2.ZERO

	if Input.is_action_pressed("ui_left"):
		velocity_input.x -= 1
	if Input.is_action_pressed("ui_right"):
		velocity_input.x += 1
	if Input.is_action_pressed("ui_up"):
		velocity_input.y -= 1
	if Input.is_action_pressed("ui_down"):
		velocity_input.y += 1

	self.velocity = velocity_input.normalized() * speed
	move_and_slide()
